"""
Botchelor live-face worker, Ditto edition: Ant Group's Ditto talking head (TensorRT) on Runpod Serverless
(docs/PRDs/digital-human.md, "Ditto"). The second of our own renderers, beside MuseTalk (workers/live-face).

Where MuseTalk paints a mouth onto the frames of the kit's idle loop, Ditto animates the whole head from ONE still:
turns, brows, blinks, a smile forming, a mouth that opens on vowels and closes on consonants. On TensorRT it renders a
2-s clause in about 1.3 s on a 4090 (the spike, 2026-11-14), the same speed as MuseTalk.

One image, two modes (MODE_TO_RUN): `pod` runs a self-test once on a sample portrait and clause; `serverless` serves
jobs. The engines load once at import; every job reuses them.

Jobs ("input" of a Runpod job):
  {"op": "speak", "source_url": "https://…png" | "source_b64": "…", "audio_b64": "…",
   "audio_format": "pcm16" | "wav", "rate": 24000,
   "fade_in": 0, "fade_out": 0, "tail_silence_ms": 0, "state_b64": null, "want_state": false,
   "sampling_timesteps": 50, "emo": 4}
      → {"video_b64": "<mp4>", "mime": "video/mp4", "frames": N, "fps": 25, "width": W, "height": H,
         "bytes": n, "state_b64": "…" (when asked), "chain": {...}, "ms": {source, setup, audio, render, encode, total}}
    Renders one clause from the still (the kit's portrait, or a frame of its loop: the clip is the still's own size,
    head and all). A video source works too (Ditto drives its frames in turn), but each clause then starts at its
    first frame.

    A CALL is a chain of clauses, and Ditto has no idle cycle to index (MuseTalk's `start_frame`), so continuity is
    motion state carried from clause to clause through the job (the worker keeps nothing between jobs; a chain may
    land on any worker):
      - the first clause starts at the still (Ditto's relative motion makes frame 0 the still itself) and `fade_in`
        frames ease the motion in;
      - every clause asked with `want_state` answers `state_b64`: its last TAIL motion frames, the conditioning frame
        before them, the 0.4 s of audio under them, and the chain's reference frame (d0);
      - the next clause sends that back as `state_b64`: the tail seeds Ditto's own window overlap (its `_fuse`), the
        audio tail gives HuBERT its context, d0 keeps the whole chain relative to the same still, and the first
        JOIN_BLEND output frames ease from the clause before's last rendered frame;
      - the last clause gets `tail_silence_ms` of silence appended (the lips close on it) and `fade_out` frames that
        bring pose and expression back to the still, so the browser can hand over to the kit's loop at its first
        frame (the portrait) with no jump.
    `sampling_timesteps` is the motion model's diffusion steps (Ditto's default 50; fewer is faster and flatter);
    `emo` picks the expression bank (Ditto's default 4, neutral).
  {"op": "warm"} → {"ok": true}
    Spins a worker up, loads the engines and renders one short clause, so a call's first clause doesn't pay for
    TensorRT's first run (about 13 s on a fresh worker).
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

HANDLER_VERSION = "chain-2"
DITTO_DIR = os.environ.get("DITTO_DIR", "/app/ditto")
DATA_ROOT = os.environ.get("DITTO_DATA_ROOT", os.path.join(DITTO_DIR, "checkpoints/ditto_trt_Ampere_Plus"))
CFG_PKL = os.environ.get("DITTO_CFG_PKL", os.path.join(DITTO_DIR, "checkpoints/ditto_cfg/v0.4_hubert_cfg_trt.pkl"))
SOURCE_CACHE = os.environ.get("SOURCE_CACHE", "/tmp/live-face-ditto")
MODE = os.environ.get("MODE_TO_RUN", "pod")
FPS = 25
SR = 16000
MAX_AUDIO_SECONDS = float(os.environ.get("MAX_AUDIO_SECONDS", "30"))
MAX_SOURCE_PX = int(os.environ.get("MAX_SOURCE_PX", "1024"))  # a kit portrait is 512², a loop frame 624²
REGISTRATIONS = int(os.environ.get("REGISTRATIONS", "16"))     # registered stills kept in memory per worker
URL_CACHE_S = int(os.environ.get("URL_CACHE_S", "900"))        # a still fetched by URL is kept this long
# The chain: Ditto's own window overlap is 10 frames (overlap_v2), so a clause hands the next its last 10 motion
# frames and the 0.4 s of audio under them; the next clause's first JOIN_BLEND frames ease from the last rendered one.
TAIL_FRAMES = 10
TAIL_SAMPLES = TAIL_FRAMES * (SR // FPS)
JOIN_BLEND = 5
STATE_V = 1
MOTION_DIM = 265

os.chdir(DITTO_DIR)
sys.path.insert(0, DITTO_DIR)
os.makedirs(SOURCE_CACHE, exist_ok=True)

import cv2  # noqa: E402
import librosa  # noqa: E402
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from core.atomic_components.condition_handler import _mirror_index  # noqa: E402
from stream_pipeline_offline import StreamSDK  # noqa: E402


def log(msg: str) -> None:
    print(f"[live-face-ditto] {msg}", flush=True)


# ------------------------------------------------------------------ engines (once per worker)
T0 = time.time()
SDK = StreamSDK(CFG_PKL, DATA_ROOT)
log(f"engines loaded in {time.time() - T0:.1f}s from {DATA_ROOT} (handler {HANDLER_VERSION})")
GPU_LOCK = threading.Lock()


class CachedRegistrar:
    """Ditto registers the still on every setup (detect, landmarks, appearance and motion features: a fraction of a
    second). A call sends the same still clause after clause, so the registration is kept per still and crop."""

    def __init__(self, inner):
        self.inner = inner
        self.cache: dict[str, dict] = {}
        self.hits = 0

    def __call__(self, source_path, **kwargs):
        key = json.dumps([source_path, sorted(kwargs.items())], default=str)
        info = self.cache.get(key)
        if info is not None:
            self.hits += 1
            return info
        info = self.inner(source_path, **kwargs)
        if len(self.cache) >= REGISTRATIONS:
            self.cache.pop(next(iter(self.cache)))
        self.cache[key] = info
        return info


SDK.avatar_registrar = CachedRegistrar(SDK.avatar_registrar)


# ------------------------------------------------------------------ the chain: Ditto's motion loop with state around it
def _chain_audio2motion_offline(self) -> None:
    """Ditto's offline motion loop (stream_pipeline_offline.StreamSDK._audio2motion_offline at the pinned commit),
    with the chain's state around it. `self.chain` (set per clause under GPU_LOCK) may carry `kp_cond` (the
    conditioning frame before the tail) and `tail` (the clause before's last motion frames, whose audio was prepended
    to this clause's): the tail seeds Ditto's own window overlap, so the model continues the motion rather than
    restarting it, and those frames are not output again. The first JOIN_BLEND output frames ease from the tail's last
    frame (the last one the clause before rendered). The whole sequence is kept on `self.chain_out` for the state the
    next clause gets."""
    while not self.stop_event.is_set():
        try:
            item = self.audio2motion_queue.get(timeout=1)
        except queue.Empty:
            continue
        if item is None:
            break
        aud_feat = item
        # Read once the clause's audio is in: this thread starts inside SDK.setup, so the state is set before setup
        # and read here, never between (chain-1 read it at thread start and missed it: the tail frames were output).
        chain = getattr(self, "chain", None) or {}
        tail = chain.get("tail")
        skip = int(tail.shape[1]) if tail is not None else 0
        aud_cond_all = self.condition_handler(aud_feat, 0)
        seq_frames = self.audio2motion.seq_frames
        valid_clip_len = self.audio2motion.valid_clip_len
        num_frames = len(aud_cond_all)
        if chain.get("kp_cond") is not None:
            self.audio2motion.kp_cond = np.ascontiguousarray(chain["kp_cond"], dtype=np.float32).reshape(1, -1)
        idx = 0
        res_kp_seq = tail.copy() if tail is not None else None
        while idx < num_frames:
            aud_cond = aud_cond_all[idx:idx + seq_frames][None]
            if aud_cond.shape[1] < seq_frames:
                pad = np.stack([aud_cond[:, -1]] * (seq_frames - aud_cond.shape[1]), 1)
                aud_cond = np.concatenate([aud_cond, pad], 1)
            res_kp_seq = self.audio2motion(aud_cond, res_kp_seq)
            idx += valid_clip_len
        res_kp_seq = res_kp_seq[:, :num_frames]
        res_kp_seq = self.audio2motion._smo(res_kp_seq, 0, res_kp_seq.shape[1])
        if skip and JOIN_BLEND:
            last = tail[:, -1]
            for i in range(min(JOIN_BLEND, num_frames - skip)):
                b = (i + 1) / (JOIN_BLEND + 1)
                res_kp_seq[:, skip + i] = last * (1 - b) + res_kp_seq[:, skip + i] * b
        self.chain_out = {"seq": res_kp_seq.copy(), "skip": skip}
        x_d_info_list = self.audio2motion.cvt_fmt(res_kp_seq[:, skip:])
        gen_frame_idx = 0
        for x_d_info in x_d_info_list:
            frame_idx = _mirror_index(gen_frame_idx, self.source_info_frames)
            ctrl_kwargs = self._get_ctrl_info(gen_frame_idx)
            while not self.stop_event.is_set():
                try:
                    self.motion_stitch_queue.put([frame_idx, x_d_info, ctrl_kwargs], timeout=1)
                    break
                except queue.Full:
                    continue
            gen_frame_idx += 1
        break
    self.motion_stitch_queue.put(None)


SDK._audio2motion_offline = _chain_audio2motion_offline.__get__(SDK, StreamSDK)


def _b64_arr(a, dtype: str) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype=dtype).tobytes()).decode()


def pack_state(kp_cond, tail, audio_tail, d0) -> str:
    """The chain's state as one opaque string: little-endian float32 motion, int16 audio, under a version."""
    return base64.b64encode(
        json.dumps(
            {
                "v": STATE_V,
                "kp_cond": _b64_arr(kp_cond, "<f4"),
                "tail": _b64_arr(tail, "<f4") if tail is not None else None,
                "tail_frames": int(tail.shape[1]) if tail is not None else 0,
                "audio_tail": _b64_arr(np.clip(audio_tail * 32767.0, -32768, 32767), "<i2") if audio_tail is not None else None,
                "d0": _b64_arr(d0, "<f4"),
            }
        ).encode()
    ).decode()


def unpack_state(s: str) -> dict:
    d = json.loads(base64.b64decode(s))
    if d.get("v") != STATE_V:
        raise ValueError(f"state v{d.get('v')} is not this worker's v{STATE_V}")

    def f32(k, shape):
        return np.frombuffer(base64.b64decode(d[k]), dtype="<f4").reshape(shape).copy() if d.get(k) else None

    t = int(d.get("tail_frames") or 0)
    tail = f32("tail", (1, t, MOTION_DIM)) if t else None
    audio_tail = np.frombuffer(base64.b64decode(d["audio_tail"]), dtype="<i2").astype(np.float32) / 32768.0 if d.get("audio_tail") else None
    if tail is not None and (audio_tail is None or len(audio_tail) != t * (SR // FPS)):
        raise ValueError("the state's audio tail doesn't match its motion tail")
    return {"kp_cond": f32("kp_cond", (1, MOTION_DIM)), "tail": tail, "audio_tail": audio_tail, "d0": f32("d0", (MOTION_DIM,))}


def export_state(seq, joint_audio, state_in: dict | None) -> str:
    """The state the next clause takes, from this clause's whole motion sequence (the incoming tail included) and the
    joint audio under it. A clause too short for a tail hands on its last frame alone (the next starts from it, no
    overlap)."""
    n = int(seq.shape[1])
    if n >= TAIL_FRAMES + 1 and len(joint_audio) >= TAIL_SAMPLES:
        tail = seq[:, n - TAIL_FRAMES:n]
        kp_cond = seq[:, n - TAIL_FRAMES - 1]
        audio_tail = joint_audio[-TAIL_SAMPLES:]
    else:
        tail = None
        kp_cond = seq[:, n - 1]
        audio_tail = None
    d0 = state_in["d0"] if state_in and state_in.get("d0") is not None else seq[0, 0]
    return pack_state(kp_cond, tail, audio_tail, d0)


# ------------------------------------------------------------------ helpers
def fetch_bytes(url: str) -> bytes:
    """The still from the show's own site or store. Named as what it is (not Python's default agent, which edge
    protection may challenge with a page instead of the file), and checked to be an image or a video."""
    req = urllib.request.Request(url, headers={"User-Agent": "botchelor-live-face/1 (+https://botchelor.com/about)", "Accept": "image/*,video/*;q=0.9,*/*;q=0.1"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 (the show's own store or site)
        kind = (r.headers.get("content-type") or "").split(";")[0].strip()
        data = r.read()
    if kind and not (kind.startswith("image/") or kind.startswith("video/") or kind == "application/octet-stream"):
        raise ValueError(f"the source URL answered {kind}, not an image")
    return data


URL_CACHE: dict[str, tuple[float, tuple[str, int, int]]] = {}


def source_for_url(url: str) -> tuple[str, int, int]:
    """A still by URL, fetched once per worker and kept (a call sends the same URL clause after clause)."""
    hit = URL_CACHE.get(url)
    if hit and time.time() - hit[0] < URL_CACHE_S and os.path.exists(hit[1][0]):
        return hit[1]
    found = source_path_for(fetch_bytes(url))
    if len(URL_CACHE) >= 64:
        URL_CACHE.pop(next(iter(URL_CACHE)))
    URL_CACHE[url] = (time.time(), found)
    return found


def source_path_for(data: bytes) -> tuple[str, int, int]:
    """The still as a PNG on disk (decoded and re-encoded, so WebP and JPEG portraits and odd colour spaces all
    arrive the same way), named by its hash so a repeat is a cache hit. A video passes through as a file."""
    sha = hashlib.sha256(data).hexdigest()[:24]
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        # not an image: let Ditto treat it as a video source
        path = os.path.join(SOURCE_CACHE, f"src-{sha}.mp4")
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(data)
        return path, 0, 0
    h, w = img.shape[:2]
    if max(h, w) > MAX_SOURCE_PX:
        s = MAX_SOURCE_PX / max(h, w)
        img = cv2.resize(img, (int(w * s) // 2 * 2, int(h * s) // 2 * 2), interpolation=cv2.INTER_AREA)
        h, w = img.shape[:2]
    if h % 2 or w % 2:  # the writer wants even sizes
        img = img[: h - h % 2, : w - w % 2]
        h, w = img.shape[:2]
    path = os.path.join(SOURCE_CACHE, f"src-{sha}.png")
    if not os.path.exists(path):
        ok, png = cv2.imencode(".png", img)  # encoded in memory: imwrite picks its encoder from the extension, and .part has none
        if not ok:
            raise ValueError("couldn't encode the still")
        with open(path + ".part", "wb") as f:
            f.write(png.tobytes())
        os.replace(path + ".part", path)
    return path, w, h


def wav_bytes(audio_b64: str, fmt: str, rate: int) -> bytes:
    """The clause as a WAV file's bytes: PCM16 mono at `rate` gets a header, a WAV passes through."""
    raw = base64.b64decode(audio_b64)
    if fmt == "wav":
        return raw
    samples = np.frombuffer(raw, dtype="<i2")
    buf = io.BytesIO()
    sf.write(buf, samples, rate, subtype="PCM_16", format="WAV")
    return buf.getvalue()


def with_silence(wav_path: str, ms: int) -> str:
    """The clause's own WAV with `ms` of silence after it (the voice for the mux, at its own rate), as a new file."""
    data, rate = sf.read(wav_path, dtype="int16", always_2d=False)
    if data.ndim > 1:
        data = data[:, 0]
    out = np.concatenate([data, np.zeros(int(rate * ms / 1000), dtype=np.int16)])
    path = wav_path[:-4] + f".sil{ms}.wav"
    sf.write(path, out, rate, subtype="PCM_16", format="WAV")
    return path


def mux(video_path: str, wav_path: str, out_path: str) -> bytes:
    """Ditto's silent H.264 plus the clause's audio as a faststart MP4 (H.264 copied, AAC)."""
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", video_path, "-i", wav_path,
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-shortest",
        "-movflags", "+faststart", out_path,
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode(errors='replace')[-400:]}")
    with open(out_path, "rb") as f:
        return f.read()


def render(source_path: str, wav_path: str, opts: dict) -> tuple[bytes, int, dict, str | None, dict]:
    """One clause through Ditto: register (cached), audio features, motion (seeded by the chain's state when there
    is one), warp, decode, put back, write; then mux. Returns the MP4, its frame count, the timings, the state for the
    next clause (when asked) and what the chain did."""
    t0 = time.time()
    audio, _ = librosa.load(wav_path, sr=SR)
    seconds = len(audio) / SR
    if seconds > MAX_AUDIO_SECONDS:
        raise ValueError(f"clause longer than {MAX_AUDIO_SECONDS}s")
    if seconds < 0.08:
        raise ValueError("the clause is empty")
    state_in = unpack_state(str(opts["state_b64"])) if opts.get("state_b64") else None
    silence_ms = max(0, min(2000, int(opts.get("tail_silence_ms") or 0)))
    fade_in = int(opts.get("fade_in") or 0)
    fade_out = int(opts.get("fade_out") or 0)
    want_state = bool(opts.get("want_state"))
    # The joint audio: the clause before's tail (its features give this one its run-up), the clause, the silence.
    parts = []
    if state_in and state_in.get("tail") is not None and state_in.get("audio_tail") is not None:
        parts.append(state_in["audio_tail"])
    parts.append(audio.astype(np.float32))
    if silence_ms:
        parts.append(np.zeros(int(SR * silence_ms / 1000), dtype=np.float32))
    joint = np.concatenate(parts)
    skip = int(state_in["tail"].shape[1]) if state_in and state_in.get("tail") is not None else 0
    num_joint = math.ceil(len(joint) / SR * FPS)
    num_out = num_joint - skip
    # A fade can't be longer than the clip it eases (setup_Nd would index frames before 0).
    fade_in = min(fade_in, max(0, num_out - 2))
    fade_out = min(fade_out, max(0, num_out - 2))
    setup_kwargs = {}
    if opts.get("sampling_timesteps"):
        setup_kwargs["sampling_timesteps"] = int(opts["sampling_timesteps"])
    if opts.get("emo") is not None:
        setup_kwargs["emo"] = int(opts["emo"])
    if fade_in > 0 or fade_out > 0:
        # Ditto fades nothing unless told what to fade towards: "s" is the still itself, all of pose and expression.
        setup_kwargs["fade_type"] = "s"
        setup_kwargs["fade_out_keys"] = ("exp", "pitch", "yaw", "roll", "t")
    mux_wav = wav_path
    with tempfile.TemporaryDirectory(dir=SOURCE_CACHE) as d:
        out_path = os.path.join(d, "clause.mp4")
        with GPU_LOCK:
            # The chain's state goes on before setup (setup starts the motion thread, which reads it with the audio).
            SDK.chain = {"kp_cond": state_in["kp_cond"], "tail": state_in["tail"]} if state_in else {}
            SDK.chain_out = None
            SDK.setup(source_path, out_path, **setup_kwargs)
            if state_in and state_in.get("d0") is not None:
                # The chain's reference frame: every clause moves relative to the same still, not to its own first frame.
                SDK.motion_stitch.d0 = SDK.audio2motion.cvt_fmt(state_in["d0"].reshape(1, 1, -1))[0]
            SDK.setup_Nd(N_d=num_out, fade_in=fade_in if fade_in > 0 else -1, fade_out=fade_out if fade_out > 0 else -1, ctrl_info={})
            t_setup = time.time()
            aud_feat = SDK.wav2feat.wav2feat(joint, sr=SR)
            t_audio = time.time()
            SDK.audio2motion_queue.put(aud_feat)
            SDK.close()
            frames = int(getattr(SDK.writer_pbar, "n", 0) or num_out)
            out = SDK.chain_out
            SDK.chain = {}
            t_render = time.time()
            if out is None or out.get("skip") != skip or frames != num_out:
                raise RuntimeError(f"the chain's state wasn't applied (skip {out and out.get('skip')} of {skip}, {frames} frames of {num_out})")
        state_out = export_state(out["seq"], joint, state_in) if want_state and out else None
        if silence_ms:
            mux_wav = with_silence(wav_path, silence_ms)
        try:
            mp4 = mux(SDK.tmp_output_path, mux_wav, out_path)
        finally:
            if mux_wav != wav_path:
                os.unlink(mux_wav)
        t_enc = time.time()
    chain = {"in": bool(state_in), "skip": skip, "fade_in": fade_in, "fade_out": fade_out, "silence_ms": silence_ms, "state": bool(state_out)}
    return mp4, frames, {
        "setup": int((t_setup - t0) * 1000),
        "audio": int((t_audio - t_setup) * 1000),
        "render": int((t_render - t_audio) * 1000),
        "encode": int((t_enc - t_render) * 1000),
        "total": int((t_enc - t0) * 1000),
    }, state_out, chain


# ------------------------------------------------------------------ speak: still + audio → clip
def speak(inp: dict) -> dict:
    t0 = time.time()
    if not inp.get("audio_b64"):
        raise ValueError("audio_b64 is required")
    if inp.get("source_b64"):
        source_path, width, height = source_path_for(base64.b64decode(inp["source_b64"]))
    elif inp.get("source_url"):
        source_path, width, height = source_for_url(str(inp["source_url"]))
    else:
        raise ValueError("source_url or source_b64 is required")
    rate = int(inp.get("rate") or SR)
    wav = wav_bytes(inp["audio_b64"], str(inp.get("audio_format") or "pcm16"), rate)
    t_source = time.time()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir=SOURCE_CACHE) as f:
        f.write(wav)
        wav_path = f.name
    try:
        mp4, frames, ms, state_out, chain = render(source_path, wav_path, inp)
    finally:
        os.unlink(wav_path)
    ms = {"source": int((t_source - t0) * 1000), **ms}
    ms["total"] = int((time.time() - t0) * 1000)
    out = {
        "video_b64": base64.b64encode(mp4).decode(),
        "mime": "video/mp4",
        "frames": frames,
        "fps": FPS,
        "width": width,
        "height": height,
        "bytes": len(mp4),
        "registrations": SDK.avatar_registrar.hits,
        "chain": chain,
        "handler": HANDLER_VERSION,
        "ms": ms,
    }
    if state_out:
        out["state_b64"] = state_out
    return out


def warmup() -> dict:
    """One short clause on the sample portrait: TensorRT's first run (about 13 s on a fresh worker) happens here,
    not on a call's first clause."""
    t = time.time()
    sample = os.path.join(DITTO_DIR, "example/image.png")
    buf = io.BytesIO()
    sf.write(buf, np.zeros(SR, dtype=np.int16), SR, subtype="PCM_16", format="WAV")
    out = speak({"source_b64": base64.b64encode(open(sample, "rb").read()).decode(), "audio_b64": base64.b64encode(buf.getvalue()).decode(), "audio_format": "wav"})
    log(f"warm in {time.time() - t:.1f}s: {out['frames']} frames, ms={json.dumps(out['ms'])}")
    return {"ok": True, "ms": out["ms"], "handler": HANDLER_VERSION}


# ------------------------------------------------------------------ dispatch
def handler(job: dict) -> dict:
    inp = job.get("input") or {}
    op = str(inp.get("op") or "speak")
    try:
        if op == "warm":
            return {**(warmup() if not _WARM else {"ok": True, "warm": "already", "handler": HANDLER_VERSION}), "registrations": len(SDK.avatar_registrar.cache)}
        if op == "speak":
            return speak(inp)
        return {"error": f"unknown op {op}"}
    except Exception as e:  # the SDK marks the job FAILED when "error" is set
        log(f"{op} failed: {e!r}")
        return {"error": str(e)[:500]}


_WARM = False


def warm_in_background() -> None:
    """The warm-up clause after the worker has registered with Runpod, not at import: a worker that spends its first
    half minute rendering before it says hello reads as unhealthy. A real job that lands first simply pays the first
    run itself (GPU_LOCK serialises them)."""

    def run() -> None:
        global _WARM
        try:
            warmup()
            _WARM = True
        except Exception as e:  # a cold first clause is the only cost of a failed warm-up
            log(f"warm-up skipped: {e!r}")

    threading.Thread(target=run, name="warm", daemon=True).start()


def self_test() -> None:
    """Pod mode: SAMPLE_DIR/portrait.(png|webp|jpg) and clause.wav → SAMPLE_OUT: the clause on its own, then as a
    chain of three pieces (first, middle, last) with the state carried, so the joins can be looked at."""
    sample = os.environ.get("SAMPLE_DIR", "/workspace/in")
    out_dir = os.environ.get("SAMPLE_OUT", "/workspace/out")
    os.makedirs(out_dir, exist_ok=True)
    portrait = next((os.path.join(sample, f"portrait.{e}") for e in ("png", "webp", "jpg") if os.path.exists(os.path.join(sample, f"portrait.{e}"))), None)
    if not portrait:
        sys.exit(f"no portrait in {sample}")
    with open(portrait, "rb") as f:
        src_b64 = base64.b64encode(f.read()).decode()
    with open(os.path.join(sample, "clause.wav"), "rb") as f:
        wav_b64 = base64.b64encode(f.read()).decode()
    s = handler({"input": {"op": "speak", "source_b64": src_b64, "audio_b64": wav_b64, "audio_format": "wav"}})
    if "error" in s:
        log(f"speak failed: {s['error']}")
        sys.exit(1)
    with open(os.path.join(out_dir, "clause.mp4"), "wb") as f:
        f.write(base64.b64decode(s["video_b64"]))
    log(f"speak → frames={s['frames']} {s['width']}x{s['height']} bytes={s['bytes']} ms={json.dumps(s['ms'])}")
    # The chain: the clause cut in three.
    data, rate = sf.read(os.path.join(sample, "clause.wav"), dtype="int16", always_2d=False)
    if data.ndim > 1:
        data = data[:, 0]
    cuts = [data[: len(data) // 3], data[len(data) // 3 : 2 * len(data) // 3], data[2 * len(data) // 3 :]]
    state = None
    for n, piece in enumerate(cuts):
        buf = io.BytesIO()
        sf.write(buf, piece, rate, subtype="PCM_16", format="WAV")
        last = n == len(cuts) - 1
        inp = {"op": "speak", "source_b64": src_b64, "audio_b64": base64.b64encode(buf.getvalue()).decode(), "audio_format": "wav", "want_state": not last, "fade_in": 6 if n == 0 else 0, "fade_out": 13 if last else 0, "tail_silence_ms": 400 if last else 0}
        if state:
            inp["state_b64"] = state
        s = handler({"input": inp})
        if "error" in s:
            log(f"chain {n} failed: {s['error']}")
            sys.exit(1)
        state = s.get("state_b64")
        with open(os.path.join(out_dir, f"chain-{n}.mp4"), "wb") as f:
            f.write(base64.b64decode(s["video_b64"]))
        log(f"chain {n} → frames={s['frames']} chain={json.dumps(s['chain'])} state={len(state) if state else 0}B ms={json.dumps(s['ms'])}")
    log("SELF_TEST_OK")


if __name__ == "__main__":
    if MODE == "serverless":
        import runpod

        warm_in_background()
        runpod.serverless.start({"handler": handler})
    else:
        warmup()
        self_test()

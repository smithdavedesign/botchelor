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
   "sampling_timesteps": 50, "emo": 4, "motion": {"kind": "sway" | "nod" | "tilt", "amount": 1.0, "period_s": 4.0, "at_s": 0.2}}
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
    `emo` picks the expression bank (Ditto's: 0 angry, 1 disgust, 2 fear, 3 happy, 4 neutral, 5 sad, 6 surprise,
    7 contempt); `motion` adds a pose on top of what the audio drives, through Ditto's per-frame pose controls
    (degrees): `sway` (a slow, small drift of pitch and yaw for an idle), `nod` (a pitch pulse at `at_s`), `tilt`
    (a roll held through the clip). The clip's fades still bring the ends back to the still.
  {"op": "warm"} → {"ok": true}
    Spins a worker up, loads the engines and renders one short clause, so a call's first clause doesn't pay for
    TensorRT's first run (about 13 s on a fresh worker).
  {"op": "stream_probe", "source_url"|"source_b64", "audio_b64", "audio_format", "rate", "overlap_v2": 60,
   "sampling_timesteps": 50, "paced": true, "emo": 4}
      → {"frames", "expected", "first_frame_ms", "lag_ms": {p50, p90, max, last}, "fed_s", "total_s", "audio_s",
         "realtime_ratio", "video_b64", ...}
    The experiment behind the streaming worker (docs/PRDs/digital-human.md, "The road from here", 2): the clause
    through Ditto's ONLINE loop (audio in as 200-ms chunks, frames out as they come), fed at the pace a call would
    (each chunk when its audio would have arrived), the wall time of every frame against the time its audio ended.
    `overlap_v2` sets how often the motion model runs (a step every 80 − overlap frames); `sampling_timesteps` its
    diffusion steps. `paced: false` feeds everything at once for the pure compute ratio.
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

HANDLER_VERSION = "stream-3"
DITTO_DIR = os.environ.get("DITTO_DIR", "/app/ditto")
DATA_ROOT = os.environ.get("DITTO_DATA_ROOT", os.path.join(DITTO_DIR, "checkpoints/ditto_trt_Ampere_Plus"))
CFG_PKL = os.environ.get("DITTO_CFG_PKL", os.path.join(DITTO_DIR, "checkpoints/ditto_cfg/v0.4_hubert_cfg_trt.pkl"))
SOURCE_CACHE = os.environ.get("SOURCE_CACHE", "/tmp/live-face-ditto")
MODE = os.environ.get("MODE_TO_RUN", "pod")
FPS = 25
SR = 16000
MAX_AUDIO_SECONDS = float(os.environ.get("MAX_AUDIO_SECONDS", "30"))
MAX_SOURCE_PX = int(os.environ.get("MAX_SOURCE_PX", "1024"))  # a kit portrait is 512², a loop frame 624²
REGISTRATIONS = int(os.environ.get("REGISTRATIONS", "16"))     # registered sources kept in memory per worker
REGISTERED_FRAMES = int(os.environ.get("REGISTERED_FRAMES", "600"))  # and at most this many frames among them (a loop is ~125, ~1 GB of features)
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

    @staticmethod
    def frames_of(info) -> int:
        return len(info.get("x_s_info_lst") or [])

    def __call__(self, source_path, **kwargs):
        key = json.dumps([source_path, sorted(kwargs.items())], default=str)
        info = self.cache.get(key)
        if info is not None:
            self.hits += 1
            self.cache[key] = self.cache.pop(key)  # most recent last
            return info
        info = self.inner(source_path, **kwargs)
        # Room: by count, and by frames (a video source, the kit's loop, carries every frame's appearance features).
        while self.cache and (len(self.cache) >= REGISTRATIONS or sum(self.frames_of(v) for v in self.cache.values()) + self.frames_of(info) > REGISTERED_FRAMES):
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
        # A video source (the kit's loop): its frames cycle forward and back under the output; `start_frame` is where
        # in that cycle this clause begins, so clause follows clause through the loop's motion (MuseTalk's recipe).
        start = int(chain.get("start_frame") or 0)
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
        ev = getattr(self, "chain_event", None)
        if ev is not None:
            ev.set()  # the state for the next clause is known now; the frames follow
        x_d_info_list = self.audio2motion.cvt_fmt(res_kp_seq[:, skip:])
        gen_frame_idx = 0
        for x_d_info in x_d_info_list:
            frame_idx = _mirror_index(start + gen_frame_idx, self.source_info_frames)
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


def _audio2motion_dispatch(self) -> None:
    """The motion thread's entry (setup starts it): Ditto's streaming loop when `stream_mode` is on, else the chain's
    offline loop. Same error handling as Ditto's own audio2motion_worker."""
    try:
        if getattr(self, "stream_mode", False):
            self._audio2motion_worker()
        else:
            self._audio2motion_offline()
    except Exception as e:  # noqa: BLE001 (Ditto's own pattern: the error surfaces from close())
        self.worker_exception = e
        self.stop_event.set()


SDK.audio2motion_worker = _audio2motion_dispatch.__get__(SDK, StreamSDK)
SDK.stream_mode = False


class FragWriter:
    """In place of Ditto's writer for a streamed clause: raw RGB frames into ffmpeg, which muxes the clause's voice and
    writes fragmented MP4 (an init segment, then a fragment every FRAG_MS or keyframe) to a pipe; a reader thread
    queues the bytes as they come, so a clause's first frames leave the worker while the rest still render."""

    def __init__(self, width: int, height: int, wav_path: str, fps: int = FPS, frag_ms: int = 200):
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0",
            "-i", wav_path,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-crf", "20", "-profile:v", "main", "-level", "3.1",
            "-g", str(fps), "-keyint_min", str(fps), "-sc_threshold", "0",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", str(frag_ms * 1000),
            "-flush_packets", "1", "-f", "mp4", "pipe:1",
        ]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.pieces: queue.Queue = queue.Queue()
        self.frames = 0
        self.bytes = 0
        self.err = b""
        threading.Thread(target=self._read, name="frag-read", daemon=True).start()
        threading.Thread(target=self._stderr, name="frag-err", daemon=True).start()

    def _read(self) -> None:
        fd = self.proc.stdout.fileno()
        try:
            while True:
                chunk = os.read(fd, 65536)  # whatever is there now (a file read would wait for the whole 64 KB)
                if not chunk:
                    break
                self.bytes += len(chunk)
                self.pieces.put(chunk)
        finally:
            self.pieces.put(None)

    def _stderr(self) -> None:
        self.err = self.proc.stderr.read() or b""

    def __call__(self, img, fmt="bgr"):
        frame = img[..., ::-1] if fmt == "bgr" else img
        self.proc.stdin.write(np.ascontiguousarray(frame, dtype=np.uint8).tobytes())
        self.frames += 1

    def close(self):
        try:
            self.proc.stdin.close()
        except Exception:  # noqa: BLE001
            pass
        self.proc.wait(timeout=60)


class TimedWriter:
    """Ditto's writer with the wall time each frame lands, for the probe's lag numbers."""

    def __init__(self, inner):
        self.inner = inner
        self.times: list[float] = []

    def __call__(self, img, fmt="bgr"):
        self.times.append(time.time())
        self.inner(img, fmt)

    def close(self):
        self.inner.close()


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
        # not an image: let Ditto treat it as a video source (the kit's loop)
        path = os.path.join(SOURCE_CACHE, f"src-{sha}.mp4")
        if not os.path.exists(path):
            with open(path + ".part", "wb") as f:
                f.write(data)
            os.replace(path + ".part", path)
        cap = cv2.VideoCapture(path)
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        cap.release()
        if not w or not h:
            raise ValueError("the source is neither an image nor a readable video")
        return path, w, h
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


def motion_ctrl(motion: dict | None, frames: int) -> dict:
    """Per-frame pose offsets (degrees) for Ditto's ctrl_info from a named motion: `sway` drifts pitch and yaw slowly
    (an idle that breathes), `nod` pulses pitch once at `at_s` for 0.6 s, `tilt` rolls the head and holds it. `amount`
    scales each (1.0 = the default size). Frames outside a motion get no entry; the clip's fades still end at the
    still."""
    if not motion or motion.get("kind") in (None, "", "none") or frames <= 0:
        return {}
    kind = str(motion.get("kind"))
    amount = float(motion.get("amount") or 1.0)
    ctrl: dict = {}
    if kind == "sway":
        period = max(1.5, float(motion.get("period_s") or 4.0))
        for i in range(frames):
            t = i / FPS
            ctrl[i] = {
                "delta_pitch": 0.8 * amount * math.sin(2 * math.pi * t / period),
                "delta_yaw": 1.4 * amount * math.sin(2 * math.pi * t / (1.37 * period) + 0.9),
                "delta_roll": 0.35 * amount * math.sin(2 * math.pi * t / (2.1 * period) + 2.0),
            }
    elif kind == "nod":
        at = float(motion.get("at_s") or 0.2)
        dur = max(0.3, float(motion.get("duration_s") or 0.6))
        for i in range(frames):
            t = i / FPS - at
            if 0 <= t <= dur:
                ctrl[i] = {"delta_pitch": 4.5 * amount * math.sin(math.pi * t / dur)}
    elif kind == "tilt":
        ramp = 0.4
        total = frames / FPS
        for i in range(frames):
            t = i / FPS
            k = min(1.0, t / ramp, max(0.0, (total - t) / ramp))
            ctrl[i] = {"delta_roll": 4.0 * amount * k, "delta_yaw": 1.5 * amount * k}
    else:
        raise ValueError(f"unknown motion {kind}")
    return ctrl


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
    is_video = source_path.endswith(".mp4")
    start_frame = max(0, int(opts.get("start_frame") or 0))
    if fade_in > 0 or fade_out > 0:
        # Ditto fades nothing unless told what to fade towards: "s" is the source frame itself. From a still that is
        # all of pose and expression; on a video the pose is the loop's already, so only the expression eases.
        setup_kwargs["fade_type"] = "s"
        setup_kwargs["fade_out_keys"] = ("exp",) if is_video else ("exp", "pitch", "yaw", "roll", "t")
    mux_wav = wav_path
    with tempfile.TemporaryDirectory(dir=SOURCE_CACHE) as d:
        out_path = os.path.join(d, "clause.mp4")
        with GPU_LOCK:
            # The chain's state goes on before setup (setup starts the motion thread, which reads it with the audio).
            SDK.chain = {"kp_cond": state_in["kp_cond"] if state_in else None, "tail": state_in["tail"] if state_in else None, "start_frame": start_frame}
            SDK.chain_out = None
            SDK.setup(source_path, out_path, **setup_kwargs)
            source_frames = int(getattr(SDK, "source_info_frames", 1) or 1)
            if state_in and state_in.get("d0") is not None:
                # The chain's reference frame: every clause moves relative to the same still, not to its own first frame.
                SDK.motion_stitch.d0 = SDK.audio2motion.cvt_fmt(state_in["d0"].reshape(1, 1, -1))[0]
            SDK.setup_Nd(N_d=num_out, fade_in=fade_in if fade_in > 0 else -1, fade_out=fade_out if fade_out > 0 else -1, ctrl_info=motion_ctrl(opts.get("motion"), num_out))
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
    chain = {"in": bool(state_in), "skip": skip, "fade_in": fade_in, "fade_out": fade_out, "silence_ms": silence_ms, "state": bool(state_out), "motion": (opts.get("motion") or {}).get("kind") or None, "emo": opts.get("emo"), "video": is_video, "start_frame": start_frame, "next_frame": start_frame + frames, "source_frames": source_frames}
    return mp4, frames, {
        "setup": int((t_setup - t0) * 1000),
        "audio": int((t_audio - t_setup) * 1000),
        "render": int((t_render - t_audio) * 1000),
        "encode": int((t_enc - t_render) * 1000),
        "total": int((t_enc - t0) * 1000),
    }, state_out, chain


# ------------------------------------------------------------------ stream probe: the online loop, fed as a call would
def stream_probe(inp: dict) -> dict:
    t_start = time.time()
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
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir=SOURCE_CACHE) as f:
        f.write(wav)
        wav_path = f.name
    try:
        audio, _ = librosa.load(wav_path, sr=SR)
        seconds = len(audio) / SR
        if seconds > MAX_AUDIO_SECONDS or seconds < 0.5:
            raise ValueError("a clause between 0.5 s and the limit, please")
        num_f = math.ceil(seconds * FPS)
        overlap = int(inp.get("overlap_v2") or 60)
        steps = int(inp.get("sampling_timesteps") or 50)
        paced = inp.get("paced", True) is not False
        chunksize = (3, 5, 2)
        split_len = int(sum(chunksize) * 0.04 * SR) + 80  # 6480
        stride = chunksize[1] * (SR // FPS)  # 3200: five frames
        padded = np.concatenate([np.zeros((chunksize[0] * (SR // FPS),), dtype=np.float32), audio.astype(np.float32)])
        setup_kwargs = {"online_mode": True, "overlap_v2": overlap, "sampling_timesteps": steps}
        if inp.get("emo") is not None:
            setup_kwargs["emo"] = int(inp["emo"])
        with tempfile.TemporaryDirectory(dir=SOURCE_CACHE) as d:
            out_path = os.path.join(d, "probe.mp4")
            with GPU_LOCK:
                SDK.chain = {}
                SDK.chain_out = None
                SDK.stream_mode = True
                try:
                    SDK.setup(source_path, out_path, **setup_kwargs)
                    SDK.writer = TimedWriter(SDK.writer)
                    SDK.setup_Nd(N_d=-1, fade_in=-1, fade_out=-1, ctrl_info={})
                    t0 = time.time()
                    fed = []
                    for i in range(0, len(padded), stride):
                        chunk = padded[i : i + split_len]
                        if len(chunk) < split_len:
                            chunk = np.pad(chunk, (0, split_len - len(chunk)), mode="constant")
                        if paced:
                            # This window's last real sample is at (i + split_len - 3*640) of the clause: wait until a call would have it.
                            at = t0 + (i + split_len - chunksize[0] * (SR // FPS)) / SR
                            while time.time() < at:
                                time.sleep(0.005)
                        SDK.run_chunk(chunk, chunksize)
                        fed.append(time.time() - t0)
                    t_fed = time.time()
                    SDK.close()
                    t_end = time.time()
                    times = list(SDK.writer.times)
                finally:
                    SDK.stream_mode = False
            frames = len(times)
            lags = [(times[n] - t0 - (n + 1) / FPS) * 1000 for n in range(frames)]
            srt = sorted(lags)
            pct = lambda q: (srt[min(len(srt) - 1, int(q * len(srt)))] if srt else None)  # noqa: E731
            mp4 = mux(SDK.tmp_output_path, wav_path, out_path) if frames else b""
    finally:
        os.unlink(wav_path)
    return {
        "video_b64": base64.b64encode(mp4).decode(),
        "mime": "video/mp4",
        "frames": frames,
        "expected": num_f,
        "width": width,
        "height": height,
        "overlap_v2": overlap,
        "sampling_timesteps": steps,
        "paced": paced,
        "first_frame_ms": int((times[0] - t0) * 1000) if frames else None,
        "lag_ms": {"p50": pct(0.5), "p90": pct(0.9), "max": (srt[-1] if srt else None), "last": (lags[-1] if lags else None)},
        "fed_s": round(t_fed - t0, 3),
        "total_s": round(t_end - t0, 3),
        "audio_s": round(seconds, 3),
        "realtime_ratio": round((t_end - t0) / seconds, 3),
        "handler": HANDLER_VERSION,
        "ms": {"total": int((time.time() - t_start) * 1000)},
    }


# ------------------------------------------------------------------ speak, streamed: state first, then fragments as frames render
def speak_stream(inp: dict):
    """The chain's `speak` as a stream (docs/PRDs/digital-human.md "streamed clauses"): the same inputs; yields
    `{"kind": "start"}`, then `{"kind": "state", "state_b64"}` the moment the motion step is done (so the next clause's
    job can be queued while this one's frames render), then `{"kind": "frag", "i", "b64"}` pieces of a fragmented MP4
    with the voice muxed in as ffmpeg produces them, then `{"kind": "end", "frames", "bytes", "ms"}`."""
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
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir=SOURCE_CACHE) as f:
        f.write(wav)
        wav_path = f.name
    mux_wav = wav_path
    try:
        audio, _ = librosa.load(wav_path, sr=SR)
        seconds = len(audio) / SR
        if seconds > MAX_AUDIO_SECONDS:
            raise ValueError(f"clause longer than {MAX_AUDIO_SECONDS}s")
        if seconds < 0.08:
            raise ValueError("the clause is empty")
        state_in = unpack_state(str(inp["state_b64"])) if inp.get("state_b64") else None
        silence_ms = max(0, min(2000, int(inp.get("tail_silence_ms") or 0)))
        fade_in = int(inp.get("fade_in") or 0)
        fade_out = int(inp.get("fade_out") or 0)
        want_state = bool(inp.get("want_state"))
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
        fade_in = min(fade_in, max(0, num_out - 2))
        fade_out = min(fade_out, max(0, num_out - 2))
        setup_kwargs = {}
        if inp.get("sampling_timesteps"):
            setup_kwargs["sampling_timesteps"] = int(inp["sampling_timesteps"])
        if inp.get("emo") is not None:
            setup_kwargs["emo"] = int(inp["emo"])
        is_video = source_path.endswith(".mp4")
        start_frame = max(0, int(inp.get("start_frame") or 0))
        if fade_in > 0 or fade_out > 0:
            setup_kwargs["fade_type"] = "s"
            setup_kwargs["fade_out_keys"] = ("exp",) if is_video else ("exp", "pitch", "yaw", "roll", "t")
        if silence_ms:
            mux_wav = with_silence(wav_path, silence_ms)
        yield {"kind": "start", "frames": num_out, "fps": FPS, "width": width, "height": height, "handler": HANDLER_VERSION, "start_frame": start_frame, "next_frame": start_frame + num_out, "chain": {"in": bool(state_in), "skip": skip, "fade_in": fade_in, "fade_out": fade_out, "silence_ms": silence_ms, "emo": inp.get("emo"), "video": is_video}}
        with tempfile.TemporaryDirectory(dir=SOURCE_CACHE) as d:
            out_path = os.path.join(d, "clause.mp4")
            with GPU_LOCK:
                SDK.chain = {"kp_cond": state_in["kp_cond"] if state_in else None, "tail": state_in["tail"] if state_in else None, "start_frame": start_frame}
                SDK.chain_out = None
                motion_done = threading.Event()
                SDK.chain_event = motion_done
                writer = None
                try:
                    SDK.setup(source_path, out_path, **setup_kwargs)
                    writer = FragWriter(width, height, mux_wav, FPS)
                    SDK.writer = writer
                    if state_in and state_in.get("d0") is not None:
                        SDK.motion_stitch.d0 = SDK.audio2motion.cvt_fmt(state_in["d0"].reshape(1, 1, -1))[0]
                    SDK.setup_Nd(N_d=num_out, fade_in=fade_in if fade_in > 0 else -1, fade_out=fade_out if fade_out > 0 else -1, ctrl_info=motion_ctrl(inp.get("motion"), num_out))
                    t_setup = time.time()
                    aud_feat = SDK.wav2feat.wav2feat(joint, sr=SR)
                    SDK.audio2motion_queue.put(aud_feat)
                    # The motion for the whole clause is one pass; the frames take longer. The state goes out first.
                    closer = threading.Thread(target=SDK.close, name="closer", daemon=True)
                    closer.start()
                    if not motion_done.wait(timeout=90):
                        raise RuntimeError("the motion step didn't finish")
                    t_motion = time.time()
                    out = SDK.chain_out
                    if out is None or out.get("skip") != skip:
                        raise RuntimeError("the chain's state wasn't applied")
                    if want_state:
                        yield {"kind": "state", "state_b64": export_state(out["seq"], joint, state_in), "ms": {"setup": int((t_setup - t0) * 1000), "motion": int((t_motion - t_setup) * 1000)}}
                    n = 0
                    t_first = None
                    while True:
                        piece = writer.pieces.get(timeout=120)
                        if piece is None:
                            break
                        if t_first is None:
                            t_first = time.time()
                        yield {"kind": "frag", "i": n, "b64": base64.b64encode(piece).decode()}
                        n += 1
                    closer.join(timeout=60)
                    if SDK.worker_exception is not None:
                        raise SDK.worker_exception
                    frames = writer.frames
                    if frames != num_out:
                        raise RuntimeError(f"{frames} frames of {num_out}")
                    if writer.proc.returncode not in (0, None):
                        raise RuntimeError(f"ffmpeg failed: {writer.err.decode(errors='replace')[-300:]}")
                finally:
                    SDK.chain = {}
                    SDK.chain_event = None
                    SDK.stream_mode = False
            yield {"kind": "end", "frames": frames, "pieces": n, "bytes": writer.bytes, "first_piece_ms": int((t_first - t0) * 1000) if t_first else None, "ms": {"setup": int((t_setup - t0) * 1000), "motion": int((t_motion - t_setup) * 1000), "total": int((time.time() - t0) * 1000)}, "handler": HANDLER_VERSION}
    finally:
        os.unlink(wav_path)
        if mux_wav != wav_path:
            try:
                os.unlink(mux_wav)
            except OSError:
                pass


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
        "next_frame": chain["next_frame"],
        "source_frames": chain["source_frames"],
        "handler": HANDLER_VERSION,
        "ms": ms,
    }
    if state_out:
        out["state_b64"] = state_out
    return out


def warmup(source_url: str | None = None) -> dict:
    """One short clause on the sample portrait: TensorRT's first run (about 13 s on a fresh worker) happens here,
    not on a call's first clause. With a `source_url`, that source (the kit's loop: every frame registered, ~5 s)
    is registered too, so the call's first clause finds it in the cache."""
    t = time.time()
    sample = os.path.join(DITTO_DIR, "example/image.png")
    buf = io.BytesIO()
    sf.write(buf, np.zeros(SR, dtype=np.int16), SR, subtype="PCM_16", format="WAV")
    out = speak({"source_b64": base64.b64encode(open(sample, "rb").read()).decode(), "audio_b64": base64.b64encode(buf.getvalue()).decode(), "audio_format": "wav"})
    registered = None
    if source_url:
        t2 = time.time()
        half = io.BytesIO()
        sf.write(half, np.zeros(SR // 2, dtype=np.int16), SR, subtype="PCM_16", format="WAV")
        try:
            speak({"source_url": source_url, "audio_b64": base64.b64encode(half.getvalue()).decode(), "audio_format": "wav"})
            registered = int((time.time() - t2) * 1000)
        except Exception as e:  # noqa: BLE001
            log(f"warm: couldn't register {source_url[:80]}: {e!r}")
    log(f"warm in {time.time() - t:.1f}s: {out['frames']} frames, ms={json.dumps(out['ms'])}, source registered in {registered} ms")
    return {"ok": True, "ms": out["ms"], "registered_ms": registered, "handler": HANDLER_VERSION}


# ------------------------------------------------------------------ dispatch
def handler(job: dict):
    """A generator for Runpod (every job streams; `return_aggregate_stream` keeps /runsync and /status whole): the
    plain ops yield their one result, `speak` with `stream: true` yields the stream (speak_stream)."""
    inp = job.get("input") or {}
    op = str(inp.get("op") or "speak")
    try:
        if op == "warm":
            yield {**(warmup(inp.get("source_url")) if (not _WARM or inp.get("source_url")) else {"ok": True, "warm": "already", "handler": HANDLER_VERSION}), "registrations": len(SDK.avatar_registrar.cache)}
        elif op == "speak" and inp.get("stream"):
            yield from speak_stream(inp)
        elif op == "speak":
            yield speak(inp)
        elif op == "stream_probe":
            yield stream_probe(inp)
        else:
            yield {"error": f"unknown op {op}"}
    except Exception as e:  # the SDK marks the job FAILED when "error" is set
        log(f"{op} failed: {e!r}")
        yield {"error": str(e)[:500]}


def handle_once(job: dict) -> dict:
    """The first item of a job's stream (pod mode and the self-test call plain ops this way)."""
    return next(handler(job))


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
    s = handle_once({"input": {"op": "speak", "source_b64": src_b64, "audio_b64": wav_b64, "audio_format": "wav"}})
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
        s = handle_once({"input": inp})
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
        runpod.serverless.start({"handler": handler, "return_aggregate_stream": True})
    else:
        warmup()
        self_test()

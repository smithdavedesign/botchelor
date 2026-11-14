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
   "audio_format": "pcm16" | "wav", "rate": 24000, "fade_in": -1, "fade_out": -1, "sampling_timesteps": 50,
   "emo": 4}
      → {"video_b64": "<mp4>", "mime": "video/mp4", "frames": N, "fps": 25, "width": W, "height": H,
         "bytes": n, "ms": {source, setup, audio, render, encode, total}}
    Renders one clause from the still (the kit's portrait, or a frame of its loop: the clip is the still's own size,
    head and all). A video source works too (Ditto drives its frames in turn), but each clause then starts at its
    first frame. `fade_in`/`fade_out` (frames) ease the motion in and out at the clip's ends; `sampling_timesteps`
    is the motion model's diffusion steps (Ditto's default 50; fewer is faster and flatter); `emo` picks the
    expression bank (Ditto's default 4).
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
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

DITTO_DIR = os.environ.get("DITTO_DIR", "/app/ditto")
DATA_ROOT = os.environ.get("DITTO_DATA_ROOT", os.path.join(DITTO_DIR, "checkpoints/ditto_trt_Ampere_Plus"))
CFG_PKL = os.environ.get("DITTO_CFG_PKL", os.path.join(DITTO_DIR, "checkpoints/ditto_cfg/v0.4_hubert_cfg_trt.pkl"))
SOURCE_CACHE = os.environ.get("SOURCE_CACHE", "/tmp/live-face-ditto")
MODE = os.environ.get("MODE_TO_RUN", "pod")
FPS = 25
MAX_AUDIO_SECONDS = float(os.environ.get("MAX_AUDIO_SECONDS", "30"))
MAX_SOURCE_PX = int(os.environ.get("MAX_SOURCE_PX", "1024"))  # a kit portrait is 512², a loop frame 624²
REGISTRATIONS = int(os.environ.get("REGISTRATIONS", "16"))     # registered stills kept in memory per worker

os.chdir(DITTO_DIR)
sys.path.insert(0, DITTO_DIR)
os.makedirs(SOURCE_CACHE, exist_ok=True)

import cv2  # noqa: E402
import librosa  # noqa: E402
import numpy as np  # noqa: E402

from stream_pipeline_offline import StreamSDK  # noqa: E402


def log(msg: str) -> None:
    print(f"[live-face-ditto] {msg}", flush=True)


# ------------------------------------------------------------------ engines (once per worker)
T0 = time.time()
SDK = StreamSDK(CFG_PKL, DATA_ROOT)
log(f"engines loaded in {time.time() - T0:.1f}s from {DATA_ROOT}")
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
    import soundfile as sf

    samples = np.frombuffer(raw, dtype="<i2")
    buf = io.BytesIO()
    sf.write(buf, samples, rate, subtype="PCM_16", format="WAV")
    return buf.getvalue()


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


def render(source_path: str, wav_path: str, opts: dict) -> tuple[bytes, int, dict]:
    """One clause through Ditto: register (cached), audio features, motion, warp, decode, put back, write; then mux.
    Returns the MP4, its frame count and the timings."""
    t0 = time.time()
    audio, _ = librosa.load(wav_path, sr=16000)
    seconds = len(audio) / 16000
    if seconds > MAX_AUDIO_SECONDS:
        raise ValueError(f"clause longer than {MAX_AUDIO_SECONDS}s")
    if seconds < 0.08:
        raise ValueError("the clause is empty")
    num_f = math.ceil(seconds * FPS)
    setup_kwargs = {}
    if opts.get("sampling_timesteps"):
        setup_kwargs["sampling_timesteps"] = int(opts["sampling_timesteps"])
    if opts.get("emo") is not None:
        setup_kwargs["emo"] = int(opts["emo"])
    with tempfile.TemporaryDirectory(dir=SOURCE_CACHE) as d:
        out_path = os.path.join(d, "clause.mp4")
        with GPU_LOCK:
            SDK.setup(source_path, out_path, **setup_kwargs)
            SDK.setup_Nd(N_d=num_f, fade_in=int(opts.get("fade_in", -1)), fade_out=int(opts.get("fade_out", -1)), ctrl_info={})
            t_setup = time.time()
            aud_feat = SDK.wav2feat.wav2feat(audio, sr=16000)
            t_audio = time.time()
            SDK.audio2motion_queue.put(aud_feat)
            SDK.close()
            frames = int(getattr(SDK.writer_pbar, "n", 0) or num_f)
            t_render = time.time()
        mp4 = mux(SDK.tmp_output_path, wav_path, out_path)
        t_enc = time.time()
    return mp4, frames, {
        "setup": int((t_setup - t0) * 1000),
        "audio": int((t_audio - t_setup) * 1000),
        "render": int((t_render - t_audio) * 1000),
        "encode": int((t_enc - t_render) * 1000),
        "total": int((t_enc - t0) * 1000),
    }


# ------------------------------------------------------------------ speak: still + audio → clip
def speak(inp: dict) -> dict:
    t0 = time.time()
    if not inp.get("audio_b64"):
        raise ValueError("audio_b64 is required")
    if inp.get("source_b64"):
        src = base64.b64decode(inp["source_b64"])
    elif inp.get("source_url"):
        src = fetch_bytes(str(inp["source_url"]))
    else:
        raise ValueError("source_url or source_b64 is required")
    source_path, width, height = source_path_for(src)
    rate = int(inp.get("rate") or 16000)
    wav = wav_bytes(inp["audio_b64"], str(inp.get("audio_format") or "pcm16"), rate)
    t_source = time.time()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir=SOURCE_CACHE) as f:
        f.write(wav)
        wav_path = f.name
    try:
        mp4, frames, ms = render(source_path, wav_path, inp)
    finally:
        os.unlink(wav_path)
    ms = {"source": int((t_source - t0) * 1000), **ms}
    ms["total"] = int((time.time() - t0) * 1000)
    return {
        "video_b64": base64.b64encode(mp4).decode(),
        "mime": "video/mp4",
        "frames": frames,
        "fps": FPS,
        "width": width,
        "height": height,
        "bytes": len(mp4),
        "registrations": SDK.avatar_registrar.hits,
        "ms": ms,
    }


def warmup() -> dict:
    """One short clause on the sample portrait: TensorRT's first run (about 13 s on a fresh worker) happens here,
    not on a call's first clause."""
    t = time.time()
    sample = os.path.join(DITTO_DIR, "example/image.png")
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, np.zeros(16000, dtype=np.int16), 16000, subtype="PCM_16", format="WAV")
    out = speak({"source_b64": base64.b64encode(open(sample, "rb").read()).decode(), "audio_b64": base64.b64encode(buf.getvalue()).decode(), "audio_format": "wav"})
    log(f"warm in {time.time() - t:.1f}s: {out['frames']} frames, ms={json.dumps(out['ms'])}")
    return {"ok": True, "ms": out["ms"]}


# ------------------------------------------------------------------ dispatch
def handler(job: dict) -> dict:
    inp = job.get("input") or {}
    op = str(inp.get("op") or "speak")
    try:
        if op == "warm":
            return {**(warmup() if not _WARM else {"ok": True, "warm": "already"}), "registrations": len(SDK.avatar_registrar.cache)}
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
    """Pod mode: SAMPLE_DIR/portrait.(png|webp|jpg) and clause.wav, clips to SAMPLE_OUT."""
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
    for n in range(2):
        s = handler({"input": {"op": "speak", "source_b64": src_b64, "audio_b64": wav_b64, "audio_format": "wav"}})
        if "error" in s:
            log(f"speak failed: {s['error']}")
            sys.exit(1)
        with open(os.path.join(out_dir, f"clause-{n}.mp4"), "wb") as f:
            f.write(base64.b64decode(s["video_b64"]))
        log(f"speak {n} → frames={s['frames']} {s['width']}x{s['height']} bytes={s['bytes']} ms={json.dumps(s['ms'])}")
    log("SELF_TEST_OK")


if __name__ == "__main__":
    if MODE == "serverless":
        import runpod

        warm_in_background()
        runpod.serverless.start({"handler": handler})
    else:
        warmup()
        self_test()

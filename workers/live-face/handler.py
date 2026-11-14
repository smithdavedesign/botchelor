"""
Botchelor live-face worker: MuseTalk 1.5 lip-sync on Runpod Serverless (docs/PRDs/digital-human.md, Tier 1b).

One image, two modes (MODE_TO_RUN): `pod` runs a self-test once on the sample loop and clause; `serverless` serves jobs.
Models load once at import; every job reuses them.

Jobs ("input" of a Runpod job):
  {"op": "prepare", "id": "<character>", "loop_url": "https://…mp4" | "loop_b64": "…", "bbox_shift": 0}
      → {"bundle_key": "live-face/<id>/<sha>.tar.gz", "frames": N, "width": W, "height": H, "fps": 25, "ms": {…},
         "loop": {"smoothed": bool, …}, "loop_key": "live-face/<id>/loop-<sha>.mp4" | null}
      A loop that is a slower render pulled down to 25 fps by repeating frames (Wan's 16 fps) is re-timed first: the
      repeats dropped and the frames between the real ones made by motion interpolation, so the head moves on every
      frame the mouth does. The re-timed loop is stored beside the bundle (`loop_key`) for the kit to show too.
    Builds the character's avatar bundle from their idle loop (landmarks, crops, VAE latents, blend masks) and puts it
    in the show's object store (MEDIA_S3_*). A bundle is a few MB; the loop's frames are kept as the loop itself.
  {"op": "speak", "bundle_key": "…", "audio_b64": "…", "audio_format": "pcm16" | "wav", "rate": 24000,
   "fps": 25, "start_frame": 0}
      → {"video_b64": "<mp4>", "mime": "video/mp4", "frames": N, "next_frame": start+N, "ms": {…}}
    Renders one clause: the mouth follows the audio, the rest of each frame is the loop's own frame, cycling forward
    then back from start_frame (so a run of clauses continues the idle motion instead of restarting it).
  {"op": "warm"} → {"ok": true}
    Spins a worker up and loads the models, so a call's first clause doesn't pay for it.
"""
from __future__ import annotations

import base64
import glob
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request

MUSETALK_DIR = os.environ.get("MUSETALK_DIR", "/app/MuseTalk")
BUNDLE_CACHE = os.environ.get("BUNDLE_CACHE", "/tmp/live-face-bundles")
MODE = os.environ.get("MODE_TO_RUN", "pod")
VERSION = "v15"
EXTRA_MARGIN = 10          # MuseTalk v1.5's default, added below the face box
PARSING_MODE = "jaw"       # v1.5's default blend mask
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "20"))
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
SMOOTH_MIN_DUP = float(os.environ.get("SMOOTH_MIN_DUP", "0.2"))  # share of repeated frames that marks a pulled-down loop
MAX_AUDIO_SECONDS = float(os.environ.get("MAX_AUDIO_SECONDS", "30"))

os.chdir(MUSETALK_DIR)
sys.path.insert(0, MUSETALK_DIR)
os.makedirs(BUNDLE_CACHE, exist_ok=True)

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
from transformers import WhisperModel  # noqa: E402

from musetalk.utils.audio_processor import AudioProcessor  # noqa: E402
from musetalk.utils.blending import get_image_blending, get_image_prepare_material  # noqa: E402
from musetalk.utils.face_parsing import FaceParsing  # noqa: E402
from musetalk.utils.utils import datagen, load_all_model  # noqa: E402


def log(msg: str) -> None:
    print(f"[live-face] {msg}", flush=True)


# ------------------------------------------------------------------ models (once per worker)
T0 = time.time()
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
vae, unet, pe = load_all_model(
    unet_model_path="models/musetalkV15/unet.pth",
    vae_type="sd-vae",
    unet_config="models/musetalkV15/musetalk.json",
    device=DEVICE,
)
TIMESTEPS = torch.tensor([0], device=DEVICE)
pe = pe.half().to(DEVICE)
vae.vae = vae.vae.half().to(DEVICE)
unet.model = unet.model.half().to(DEVICE)
WEIGHT_DTYPE = unet.model.dtype
audio_processor = AudioProcessor(feature_extractor_path="models/whisper")
whisper = WhisperModel.from_pretrained("models/whisper").to(device=DEVICE, dtype=WEIGHT_DTYPE).eval()
whisper.requires_grad_(False)
face_parser = FaceParsing(left_cheek_width=90, right_cheek_width=90)
log(f"models ready in {time.time() - T0:.1f}s on {DEVICE} ({torch.cuda.get_device_name(0) if DEVICE.type == 'cuda' else 'cpu'})")

GPU_LOCK = threading.Lock()


@torch.no_grad()
def warmup() -> None:
    """One pass through Whisper, the UNet and the VAE on nothing, so the first clause doesn't pay for CUDA's first run
    (measured 2026-11-13: 4.7 s of audio features and 2 s of extra render on a worker's first clause, 10 ms and 0 after)."""
    if DEVICE.type != "cuda":
        return
    t = time.time()
    try:
        import soundfile as sf

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            sf.write(f.name, np.zeros(16000, dtype=np.int16), 16000, subtype="PCM_16", format="WAV")
            path = f.name
        try:
            feats, length = audio_processor.get_audio_feature(path, weight_dtype=WEIGHT_DTYPE)
            chunks = audio_processor.get_whisper_chunk(feats, DEVICE, WEIGHT_DTYPE, whisper, length, fps=25, audio_padding_length_left=2, audio_padding_length_right=2)
        finally:
            os.unlink(path)
        latent = torch.zeros((1, 8, 32, 32), device=DEVICE, dtype=unet.model.dtype)
        for whisper_batch, _ in datagen(chunks[:BATCH_SIZE], [latent.cpu()] * BATCH_SIZE, BATCH_SIZE):
            pred = unet.model(latent.repeat(whisper_batch.shape[0], 1, 1, 1), TIMESTEPS, encoder_hidden_states=pe(whisper_batch.to(DEVICE))).sample
            vae.decode_latents(pred.to(device=DEVICE, dtype=vae.vae.dtype))
            break
        torch.cuda.synchronize()
        log(f"warm in {time.time() - t:.1f}s")
    except Exception as e:  # a cold first clause is the only cost of a failed warm-up
        log(f"warm-up skipped: {e!r}")


warmup()


# ------------------------------------------------------------------ object store (the show's bucket)
def s3_client():
    endpoint = os.environ.get("MEDIA_S3_ENDPOINT", "").rstrip("/")
    bucket = os.environ.get("MEDIA_S3_BUCKET", "")
    key_id = os.environ.get("MEDIA_S3_ACCESS_KEY_ID", "")
    secret = os.environ.get("MEDIA_S3_SECRET_ACCESS_KEY", "")
    if not (endpoint and bucket and key_id and secret):
        return None, None
    import boto3
    from botocore.config import Config

    region = os.environ.get("MEDIA_S3_REGION") or next((m for m in endpoint.split(".") if m.count("-") == 2 and m[:2].isalpha()), "us-east-1")
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    return client, bucket


def store_put(key: str, data: bytes, mime: str) -> None:
    client, bucket = s3_client()
    if client is None:
        raise RuntimeError("no object store configured (MEDIA_S3_*)")
    client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=mime, CacheControl="private, max-age=31536000, immutable")


def store_get(key: str) -> bytes:
    client, bucket = s3_client()
    if client is None:
        raise RuntimeError("no object store configured (MEDIA_S3_*)")
    return client.get_object(Bucket=bucket, Key=key)["Body"].read()


# ------------------------------------------------------------------ helpers
def fetch_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310 (our own store's link)
        return r.read()


def decode_video(data: bytes) -> tuple[list[np.ndarray], float]:
    """Every frame of an MP4 (BGR) and its frame rate."""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        f.write(data)
        path = f.name
    try:
        cap = cv2.VideoCapture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frames = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
        cap.release()
    finally:
        os.unlink(path)
    if not frames:
        raise ValueError("the loop has no frames")
    return frames, fps


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


def encode_mp4(frames: list[np.ndarray], fps: int, wav: bytes) -> bytes:
    """Frames (BGR) plus the clause's audio as a faststart MP4 (H.264 + AAC), through one ffmpeg run on pipes."""
    h, w = frames[0].shape[:2]
    # The MP4 muxer needs a seekable output for faststart, so the file goes through /tmp (tmpfs-fast, a few hundred KB).
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(wav)
        wav_path = f.name
    out_path = wav_path[:-4] + ".mp4"
    try:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "pipe:0",
            "-i", wav_path,
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-crf", "21", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "96k", "-shortest",
            "-movflags", "+faststart", out_path,
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        _, err = proc.communicate(b"".join(np.ascontiguousarray(fr).tobytes() for fr in frames))
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {err.decode(errors='replace')[-400:]}")
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        os.unlink(wav_path)
        if os.path.exists(out_path):
            os.unlink(out_path)


# ------------------------------------------------------------------ prepare: loop → bundle
def smooth_loop(data: bytes) -> tuple[bytes, dict]:
    """A loop whose motion is slower than its frame rate (Wan renders at 16 fps; the kit's file says 25, so 38% of
    Juniper's frames were repeats of the one before) has the repeats dropped, the real frames spread at their own rate
    and the frames between them made by motion interpolation (ffmpeg's minterpolate), so the head moves on every frame
    the mouth is drawn on. A loop without that pattern passes through untouched. Returns the loop and what was done."""
    work = tempfile.mkdtemp(prefix="smooth-")
    try:
        src = os.path.join(work, "in.mp4")
        with open(src, "wb") as f:
            f.write(data)
        cap = cv2.VideoCapture(src)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
        cap.release()
        if total < 10:
            return data, {"smoothed": False, "why": "too short"}
        # Pass 1: how many frames mpdecimate keeps (its default thresholds drop the repeats and keep subtle real motion:
        # Juniper's 127 → 79, the same 48 the plain frame difference calls repeats).
        p = subprocess.run([FFMPEG, "-v", "info", "-i", src, "-vf", "mpdecimate", "-an", "-f", "null", "-"], capture_output=True, text=True, timeout=180)
        counts = re.findall(r"frame=\s*(\d+)", p.stderr)
        unique = int(counts[-1]) if counts else total
        dup = (total - unique) / total
        if dup < SMOOTH_MIN_DUP:
            return data, {"smoothed": False, "frames": total, "unique": unique, "dup": round(dup, 3)}
        src_fps = unique / (total / fps)
        out = os.path.join(work, "out.mp4")
        vf = f"mpdecimate,setpts=N/({src_fps:.4f}*TB),minterpolate=fps=25:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none"
        subprocess.run(
            [FFMPEG, "-v", "error", "-y", "-i", src, "-vf", vf, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
            check=True, capture_output=True, timeout=900,
        )
        with open(out, "rb") as f:
            smooth = f.read()
        return smooth, {"smoothed": True, "frames": total, "unique": unique, "dup": round(dup, 3), "from_fps": round(src_fps, 2)}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def prepare(inp: dict) -> dict:
    t0 = time.time()
    char_id = str(inp.get("id") or "").strip()
    if not char_id:
        raise ValueError("id is required")
    if inp.get("loop_b64"):
        loop = base64.b64decode(inp["loop_b64"])
    elif inp.get("loop_url"):
        loop = fetch_bytes(inp["loop_url"])
    else:
        raise ValueError("loop_url or loop_b64 is required")
    bbox_shift = int(inp.get("bbox_shift") or 0)
    loop, smooth = smooth_loop(loop)
    t_smooth = time.time()
    log(f"prepare {char_id}: loop {json.dumps(smooth)}")

    # Landmarks + face boxes need image files (MuseTalk reads paths) and load dwpose on first use.
    from musetalk.utils.preprocessing import get_landmark_and_bbox

    frames, fps = decode_video(loop)
    h, w = frames[0].shape[:2]
    work = tempfile.mkdtemp(prefix="prep-")
    try:
        paths = []
        for i, fr in enumerate(frames):
            p = os.path.join(work, f"{i:08d}.png")
            cv2.imwrite(p, fr)
            paths.append(p)
        with GPU_LOCK:
            coord_list, frame_list = get_landmark_and_bbox(paths, bbox_shift)
            coords, latents, masks, mask_boxes = [], [], [], []
            for bbox, frame in zip(coord_list, frame_list):
                if tuple(bbox) == (0.0, 0.0, 0.0, 0.0):
                    raise ValueError("no face found in one of the loop's frames")
                x1, y1, x2, y2 = (int(v) for v in bbox)
                y2 = min(y2 + EXTRA_MARGIN, frame.shape[0])
                crop = cv2.resize(frame[y1:y2, x1:x2], (256, 256), interpolation=cv2.INTER_LANCZOS4)
                latents.append(vae.get_latents_for_unet(crop).half().cpu())
                mask, crop_box = get_image_prepare_material(frame, [x1, y1, x2, y2], fp=face_parser, mode=PARSING_MODE)
                coords.append([x1, y1, x2, y2])
                masks.append(mask.astype(np.uint8))
                mask_boxes.append([int(v) for v in crop_box])
    finally:
        shutil.rmtree(work, ignore_errors=True)
    t_prep = time.time()

    info = {"id": char_id, "version": 1, "musetalk": VERSION, "fps": int(round(fps)), "width": w, "height": h, "frames": len(frames), "bbox_shift": bbox_shift, "extra_margin": EXTRA_MARGIN, "loop": smooth, "parsing_mode": PARSING_MODE}
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        def add(name: str, data: bytes) -> None:
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            ti.mtime = int(t0)
            tar.addfile(ti, io.BytesIO(data))
        add("info.json", json.dumps(info).encode())
        add("loop.mp4", loop)
        add("coords.json", json.dumps(coords).encode())
        add("mask_boxes.json", json.dumps(mask_boxes).encode())
        lat = io.BytesIO()
        torch.save(latents, lat)
        add("latents.pt", lat.getvalue())
        npz = io.BytesIO()
        np.savez_compressed(npz, *masks)
        add("masks.npz", npz.getvalue())
    bundle = buf.getvalue()
    sha = hashlib.sha256(bundle).hexdigest()[:16]
    key = f"live-face/{char_id}/{sha}.tar.gz"
    if inp.get("local_path"):
        with open(inp["local_path"], "wb") as f:
            f.write(bundle)
    else:
        store_put(key, bundle, "application/gzip")
    _cache_put(key, bundle)
    loop_key = None
    if smooth.get("smoothed"):
        loop_key = f"live-face/{char_id}/loop-{hashlib.sha256(loop).hexdigest()[:16]}.mp4"
        if not inp.get("local_path"):
            store_put(loop_key, loop, "video/mp4")
    return {"bundle_key": key, "loop_key": loop_key, "loop": smooth, "frames": len(frames), "width": w, "height": h, "fps": info["fps"], "bytes": len(bundle), "ms": {"smooth": int((t_smooth - t0) * 1000), "prepare": int((t_prep - t_smooth) * 1000), "pack": int((time.time() - t_prep) * 1000)}}


# ------------------------------------------------------------------ bundles in memory
_BUNDLES: dict[str, dict] = {}


def _cache_put(key: str, bundle: bytes) -> None:
    path = os.path.join(BUNDLE_CACHE, hashlib.sha256(key.encode()).hexdigest() + ".tar.gz")
    with open(path, "wb") as f:
        f.write(bundle)


def load_bundle(key: str, local_path: str | None = None) -> dict:
    if key in _BUNDLES:
        return _BUNDLES[key]
    path = local_path or os.path.join(BUNDLE_CACHE, hashlib.sha256(key.encode()).hexdigest() + ".tar.gz")
    if not os.path.exists(path):
        data = store_get(key)
        with open(path, "wb") as f:
            f.write(data)
    with tarfile.open(path, "r:gz") as tar:
        def read(name: str) -> bytes:
            m = tar.extractfile(name)
            if m is None:
                raise ValueError(f"bundle lacks {name}")
            return m.read()
        info = json.loads(read("info.json"))
        frames, _ = decode_video(read("loop.mp4"))
        coords = json.loads(read("coords.json"))
        mask_boxes = json.loads(read("mask_boxes.json"))
        latents = torch.load(io.BytesIO(read("latents.pt")), map_location="cpu")
        with np.load(io.BytesIO(read("masks.npz"))) as z:
            masks = [z[f"arr_{i}"] for i in range(len(z.files))]
    n = min(len(frames), len(coords), len(latents), len(masks))
    if n == 0:
        raise ValueError("empty bundle")
    cyc = lambda xs: list(xs[:n]) + list(xs[:n])[::-1]  # noqa: E731 forward then back, as MuseTalk does
    b = {"info": info, "frames": cyc(frames), "coords": cyc(coords), "latents": cyc(latents), "masks": cyc(masks), "mask_boxes": cyc(mask_boxes)}
    _BUNDLES[key] = b
    return b


# ------------------------------------------------------------------ speak: audio → clip
@torch.no_grad()
def speak(inp: dict) -> dict:
    t0 = time.time()
    key = str(inp.get("bundle_key") or "")
    if not key:
        raise ValueError("bundle_key is required")
    if not inp.get("audio_b64"):
        raise ValueError("audio_b64 is required")
    fps = int(inp.get("fps") or 25)
    start = int(inp.get("start_frame") or 0)
    rate = int(inp.get("rate") or 16000)
    wav = wav_bytes(inp["audio_b64"], str(inp.get("audio_format") or "pcm16"), rate)
    b = load_bundle(key, inp.get("local_path"))
    t_load = time.time()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(wav)
        wav_path = f.name
    try:
        with GPU_LOCK:
            feats, length = audio_processor.get_audio_feature(wav_path, weight_dtype=WEIGHT_DTYPE)
            if length / 16000 > MAX_AUDIO_SECONDS:
                raise ValueError(f"clause longer than {MAX_AUDIO_SECONDS}s")
            chunks = audio_processor.get_whisper_chunk(feats, DEVICE, WEIGHT_DTYPE, whisper, length, fps=fps, audio_padding_length_left=2, audio_padding_length_right=2)
            t_audio = time.time()
            n_cycle = len(b["latents"])
            # datagen walks the latents from index 0; rotate so the clause starts at start_frame of the cycle
            rot = start % n_cycle
            latents = b["latents"][rot:] + b["latents"][:rot]
            out_frames: list[np.ndarray] = []
            i = 0
            for whisper_batch, latent_batch in datagen(chunks, latents, BATCH_SIZE):
                audio_feature_batch = pe(whisper_batch.to(DEVICE))
                latent_batch = latent_batch.to(device=DEVICE, dtype=unet.model.dtype)
                pred = unet.model(latent_batch, TIMESTEPS, encoder_hidden_states=audio_feature_batch).sample
                recon = vae.decode_latents(pred.to(device=DEVICE, dtype=vae.vae.dtype))
                for res in recon:
                    j = (start + i) % n_cycle
                    x1, y1, x2, y2 = b["coords"][j]
                    face = cv2.resize(res.astype(np.uint8), (x2 - x1, y2 - y1))
                    out_frames.append(get_image_blending(b["frames"][j], face, (x1, y1, x2, y2), b["masks"][j], b["mask_boxes"][j]))
                    i += 1
            t_render = time.time()
    finally:
        os.unlink(wav_path)
    if not out_frames:
        raise ValueError("the clause produced no frames (silent or too short)")
    mp4 = encode_mp4(out_frames, fps, wav)
    t_enc = time.time()
    return {
        "video_b64": base64.b64encode(mp4).decode(),
        "mime": "video/mp4",
        "frames": len(out_frames),
        "next_frame": (start + len(out_frames)) % n_cycle,
        "cycle": n_cycle,
        "width": b["info"]["width"],
        "height": b["info"]["height"],
        "bytes": len(mp4),
        "ms": {"load": int((t_load - t0) * 1000), "audio": int((t_audio - t_load) * 1000), "render": int((t_render - t_audio) * 1000), "encode": int((t_enc - t_render) * 1000), "total": int((t_enc - t0) * 1000)},
    }


# ------------------------------------------------------------------ dispatch
def handler(job: dict) -> dict:
    inp = job.get("input") or {}
    op = str(inp.get("op") or "speak")
    try:
        if op == "warm":
            return {"ok": True, "device": str(DEVICE), "bundles": list(_BUNDLES)}
        if op == "prepare":
            return prepare(inp)
        if op == "speak":
            return speak(inp)
        return {"error": f"unknown op {op}"}
    except Exception as e:  # the SDK marks the job FAILED when "error" is set
        log(f"{op} failed: {e!r}")
        return {"error": str(e)[:500]}


def self_test() -> None:
    """Pod mode: the sample loop and clause from SAMPLE_DIR, bundle on disk, clip beside it."""
    sample = os.environ.get("SAMPLE_DIR", "/workspace/in")
    out_dir = os.environ.get("SAMPLE_OUT", "/workspace/out")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(sample, "loop.mp4"), "rb") as f:
        loop_b64 = base64.b64encode(f.read()).decode()
    with open(os.path.join(sample, "clause.wav"), "rb") as f:
        wav_b64 = base64.b64encode(f.read()).decode()
    bundle_path = os.path.join(out_dir, "juniper.tar.gz")
    r = handler({"input": {"op": "prepare", "id": "house-juniper", "loop_b64": loop_b64, "local_path": bundle_path}})
    log(f"prepare → {json.dumps({k: v for k, v in r.items() if k != 'video_b64'})}")
    if "error" in r:
        sys.exit(1)
    for n in range(2):
        s = handler({"input": {"op": "speak", "bundle_key": r["bundle_key"], "local_path": bundle_path, "audio_b64": wav_b64, "audio_format": "wav", "start_frame": 37 * n}})
        if "error" in s:
            log(f"speak failed: {s['error']}")
            sys.exit(1)
        with open(os.path.join(out_dir, f"clause-{n}.mp4"), "wb") as f:
            f.write(base64.b64decode(s["video_b64"]))
        log(f"speak {n} → frames={s['frames']} next={s['next_frame']} bytes={s['bytes']} ms={json.dumps(s['ms'])}")
    log("SELF_TEST_OK")


if __name__ == "__main__":
    if MODE == "serverless":
        import runpod

        runpod.serverless.start({"handler": handler})
    else:
        self_test()

# Ditto spike (2026-11-14): can Ant Group's Ditto replace MuseTalk as the live-face renderer?

> The spike's report as written on the day, kept with the worker it led to. Paths under `out/` were the session's
> scratchpad; the clips and frame strips it names are not in the repository. The worker (`handler.py`, `Dockerfile`)
> follows the TensorRT recipe below, with cuDNN 8 from the CUDA base image instead of the extracted wheel.

Pod: Runpod secure RTX 4090, `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404` (Python 3.12, torch 2.8.0+cu128), 40 GB disk.
Repo: github.com/antgroup/ditto-talkinghead @ main (2026-11-14), Apache-2.0. Weights: HF `digital-avatar/ditto-talkinghead`
(PyTorch models 714 MB + aux ONNX 1.6 GB, of which HuBERT is 1.46 GB; TRT engines 2.0 GB; ONNX 2.4 GB), MIT-style terms on the
model card (check the card before shipping; the code is Apache-2.0).

## Verdict

**Quality: clearly better than MuseTalk on Juniper.** From one 512-px portrait Ditto animates the whole head: head turns and
tilts, brows, blinks, a smile that forms and fades, and a mouth that opens wide on vowels, closes on consonants and shows
teeth. MuseTalk's clause on the same audio (`out/endpoint-clause.mp4`, `out/frames/sheet-mouth.png`) is a small, soft mouth
pasted on a fixed loop. Ditto's identity holds across the clip; the face is slightly smoothed (diffusion look) and the
background is static (it animates the head only, so the kit's idle loop would no longer be the source: the source is ONE
still). No edge artefacts at 512 px; a few frames show the teeth slightly smeared. Frame strips:
`out/ditto/strip-portrait-full.png`, `out/ditto/strip-portrait-mouth.png` (portrait source),
`out/ditto/strip-frame0-full.png`, `out/ditto/strip-frame0-mouth.png` (the 624-px loop's first frame as source).

**Speed, PyTorch path: about 2× slower than real time, so NOT live as is.** Steady state on the 4090 (models kept loaded):

| run | audio | wall | RTF |
|---|---|---|---|
| portrait 512 px, 5.6-s clause (×3) | 5.64 s | 12.2 / 11.3 / 10.9 s | 2.16 / 2.01 / 1.93 |
| loop frame 624 px, 5.6-s clause | 5.64 s | 11.5 s | 2.04 |
| portrait, 2-s clause (×2) | 2.00 s | 4.24 / 4.13 s | 2.12 / 2.06 |

Model load 5.3 s; GPU memory 4.7 GB during inference (1.1 GB idle). First-ever call was 98.7 s because onnxruntime's default
wheel is a CUDA 13 build and HuBERT ran on CPU (see recipe). A 2-s clause at 4.1 s is twice MuseTalk's ~1.2 s render for the
same clause; with our ~1 s of fixed overhead that is a 5-s first clip, outside the 4-s hold.

**Online (streaming) mode as shipped is not usable:** `stream_pipeline_online` with the online config and the PyTorch models
wrote 85 of 141 frames for the 5.6-s clause (RTF 1.44 on the partial) and 0 frames for the 2-s clause; the pipeline needs
its own flush/padding handling that `inference.py` does not do. Not pursued further in the budget.

**Speed, TensorRT path: real time with room to spare, so YES for live.** The shipped `ditto_trt_Ampere_Plus` engines
(TRT 8.6.1, hardware-compatibility Ampere_Plus) load and run on the 4090 as they are, no conversion:

| run | audio | wall | RTF |
|---|---|---|---|
| 5.6-s clause, first call (engine warm-up) | 5.64 s | 13.0 s | 2.31 |
| 5.6-s clause, warm | 5.64 s | 3.56 s | 0.63 |
| 2-s clause, warm (×2) | 2.00 s | 1.33 / 1.30 s | 0.67 / 0.65 |
| 624-px loop frame as source, 5.6-s | 5.64 s | 3.70 s | 0.66 |

Engine load 2.7 s; GPU memory 2.8 GB. Output is visually the same as the PyTorch path (`out/ditto/strip-trt-mouth.png`,
`out/ditto/strip-trt-full.png`; clips `out/ditto/trt-2-s.mp4`, `trt-5.6-s.mp4`, `trt-frame0.mp4`). That is MuseTalk's
render speed (0.57× real time) with a whole-face result: a 2-s clause ≈ 1.3 s render + our ~1 s of overhead ≈ 2.3 s to
the first clip, inside the 4-s hold.

## Install recipe that worked (PyTorch path, this image)

```sh
apt-get install -y ffmpeg git-lfs libgl1 libglib2.0-0 libegl1 libgles2 libopengl0     # mediapipe needs libEGL
git clone https://github.com/antgroup/ditto-talkinghead && cd ditto-talkinghead
pip install --break-system-packages "huggingface_hub[hf_transfer]" librosa tqdm filetype imageio imageio-ffmpeg \
  opencv-python-headless scikit-image cython colored mediapipe einops
# onnxruntime-gpu from PyPI (1.32) is built for CUDA 13: use the CUDA 12 feed, or HuBERT + the detectors run on CPU
pip install --break-system-packages --force-reinstall --no-deps onnxruntime-gpu \
  --index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/   # 1.29.0
HF_HUB_ENABLE_HF_TRANSFER=1 python -c 'from huggingface_hub import snapshot_download as d; d("digital-avatar/ditto-talkinghead", local_dir="checkpoints", allow_patterns=["ditto_cfg/*","ditto_pytorch/**"])'
# cuDNN 9 / CUDA 12 libs for onnxruntime come from torch's pip wheels:
export LD_LIBRARY_PATH=$(python -c 'import glob,os; print(":".join(sorted(d for d in glob.glob("/usr/local/lib/python3.12/dist-packages/nvidia/*/lib"))))'):$LD_LIBRARY_PATH
python inference.py --data_root ./checkpoints/ditto_pytorch --cfg_pkl ./checkpoints/ditto_cfg/v0.4_hubert_cfg_pytorch.pkl \
  --audio_path clause.wav --source_path portrait.png --output_path out.mp4
```
Versions that ran: numpy 2.1.2, onnxruntime-gpu 1.29.0 (CUDA 12 build), mediapipe 1.2.3, librosa 1.0.1, opencv 5.0.0, einops 0.8.2.
Gotchas hit: PEP 668 (`--break-system-packages`), missing libEGL for mediapipe, missing einops, the CUDA 13 onnxruntime.

## Integration sketch for workers/live-face/handler.py

- `prepare(character)`: run Ditto's `avatar_registrar` on the kit's PORTRAIT (not the loop; Ditto moves the head itself)
  once and cache the `source_info` (crop, keypoints, appearance features) with the character, as the MuseTalk bundle is cached.
  Setup is a fraction of a second; registration cost is negligible against the 2.2 GB of models that must stay resident.
- `speak(audio)`: `SDK.setup(portrait, tmp)` with the cached source info, `wav2feat` on the 16-kHz clause, `audio2motion`
  → motion stitch → warp → decode → frames, then our `encode_mp4` with the voice muxed in. Ditto has no idle cycle: each
  clause starts from the neutral portrait pose unless we pass `ctrl_info`/the previous clip's last motion as the start
  (the SDK accepts per-frame control info and fades: `fade_in`/`fade_out`, `overall_ctrl_info` such as `delta_pitch`), so
  continuity between clips means carrying the last keypoint state forward, not a frame index as with MuseTalk's `start_frame`.
  Between clips the kit's still-mouth loop would show, which is a visible change of renderer unless the loop is also
  Ditto-made (feasible: a silent clause renders idle motion).
- Memory: both renderers resident = 4.7 GB (Ditto) + ~6 GB (MuseTalk) on a 24-GB card: fine.
- Per-clause latency for a 2-s clause: PyTorch ~4.1 s render (+~1 s overhead ≈ 5 s, outside the hold); TensorRT ~1.3 s
  (≈ 2.3 s to the first clip). Ship the TensorRT path.
- Worker image for it: Python 3.10 (TensorRT 8.6.1 wheels stop at 3.11), torch 2.5.1+cu121, `tensorrt==8.6.1` from
  `--extra-index-url https://pypi.nvidia.com`, cuDNN **8** libs for TensorRT beside torch's cuDNN 9 (extract
  `nvidia-cudnn-cu12==8.9.7.29`'s `nvidia/cudnn/lib` to its own dir and put it first on `LD_LIBRARY_PATH`; installing it as a
  package would downgrade torch's cuDNN), `cuda-python==12.6.2.post1`, onnxruntime-gpu from the CUDA-12 feed (the detectors
  and landmarkers are ONNX even on the TRT path), mediapipe + libEGL, einops, numpy 2.0.1. MuseTalk's image is CUDA 11.8 /
  torch 2.0.1, so Ditto is a SECOND image and endpoint (or a second container), not a layer on the first: the renderer
  interface the parent is building picks per character which endpoint to call.
- The first call on a fresh worker pays ~13 s of engine warm-up (plus the pull): do it in `warm`, as MuseTalk's worker does.
- Output is 512² from a 512-px portrait (it renders at the source's size; the 624-px loop frame gave 624²). The kit's
  portrait is 512², the loop 624²: feed the 624 frame so the clip matches the round frame without upscaling.

## TensorRT recipe (what finally worked)

```sh
pip install --break-system-packages uv && uv python install 3.10 && uv venv --python 3.10 /root/trt-venv
uv pip install --python /root/trt-venv/bin/python torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu121
uv pip install --python /root/trt-venv/bin/python cuda-python==12.6.2.post1 numpy==2.0.1 librosa tqdm filetype imageio imageio-ffmpeg \
  opencv_python_headless scikit-image cython colored polygraphy einops soundfile mediapipe
uv pip install --python /root/trt-venv/bin/python onnxruntime-gpu --index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/
/root/trt-venv/bin/python -m ensurepip && /root/trt-venv/bin/python -m pip install tensorrt==8.6.1 --extra-index-url https://pypi.nvidia.com   # uv's build isolation broke tensorrt_libs
/root/trt-venv/bin/python -m pip download --no-deps nvidia-cudnn-cu12==8.9.7.29 -d /root/wheels && (cd /root/cudnn8 && unzip -o /root/wheels/nvidia_cudnn_cu12-8.9.7.29-*.whl "nvidia/cudnn/lib/*")
export LD_LIBRARY_PATH=/root/cudnn8/nvidia/cudnn/lib:<venv nvidia/*/lib except cudnn>:<venv tensorrt_libs dir>:$LD_LIBRARY_PATH
python inference.py --data_root ./checkpoints/ditto_trt_Ampere_Plus --cfg_pkl ./checkpoints/ditto_cfg/v0.4_hubert_cfg_trt.pkl ...
```

## Cost and clean-up

One secure 4090 at $0.89/h for 2.4 h ≈ $2.14 (over the 2-h budget by ~20 min: the background waits ran longer than I
tracked). Pod deleted 2026-11-14; `GET /v2/pods` → none. Nothing on Runpod from this spike bills further.

## Bottom line

Ditto beats MuseTalk on quality by a clear margin (whole-face motion, real articulation, teeth) and, on TensorRT, matches
its speed (RTF 0.65, 2-s clause in 1.3 s, 2.8 GB). It costs a second worker image (CUDA 12.1 / Python 3.10 / TRT 8.6) and
loses MuseTalk's idle-loop continuity: clips start from the portrait pose, so continuity is carried as motion state, and the
between-clip loop should be Ditto-rendered too. Online/streaming mode is not usable as shipped. Recommend: build the Ditto
worker image and endpoint, put it behind the renderer interface as `ditto`, and compare on the admin page.


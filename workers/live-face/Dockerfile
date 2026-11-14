# Botchelor live-face worker: MuseTalk 1.5 lip-sync on Runpod Serverless (workers/live-face/README.md).
# Built for linux/amd64 by .github/workflows/live-face-worker.yml; the weights are baked in (~4 GB) so a cold worker
# needs no network volume and no data-center pin.
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    MUSETALK_DIR=/app/MuseTalk MODE_TO_RUN=serverless BUNDLE_CACHE=/tmp/live-face-bundles

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.10 python3.10-venv python3-pip ffmpeg git ca-certificates curl libgl1 libglib2.0-0 libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/local/bin/python

# MuseTalk at a pinned commit (the one the spike ran on 2026-11-13)
ARG MUSETALK_COMMIT=0a89dec45a0192b824e3cf4daf96c239440c5ed8
RUN git clone https://github.com/TMElyralab/MuseTalk /app/MuseTalk \
    && cd /app/MuseTalk && git checkout ${MUSETALK_COMMIT} && rm -rf .git

WORKDIR /app/MuseTalk
COPY requirements.txt constraints.txt /app/
# constraints.txt holds the pins every step below must keep (numpy 1.x above all: see the file).
ENV PIP_CONSTRAINT=/app/constraints.txt
RUN python -m pip install --upgrade pip wheel "setuptools<81" \
    && python -m pip install torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cu118 \
    && python -m pip install -r /app/requirements.txt \
    && python -m pip install mmengine "mmcv==2.0.1" --find-links https://download.openmmlab.com/mmcv/dist/cu118/torch2.0/index.html \
    && python -m pip install --no-build-isolation "chumpy==0.70" \
    && python -m pip install "mmdet==3.1.0" "mmpose==1.1.0" gdown

# Fail the build, not the first job, if the stack is inconsistent: numpy must be the 1.x the compiled wheels expect, and
# the preprocessing path (mmpose + xtcocotools + cv2) must import.
RUN python -c "import numpy, cv2, torch; assert numpy.__version__ == '1.23.5', numpy.__version__; import xtcocotools._mask; from mmpose.apis import init_model; print('stack ok: numpy', numpy.__version__, 'cv2', cv2.__version__, 'torch', torch.__version__)"

# Weights: MuseTalk 1.5 UNet, SD VAE, Whisper tiny, DWPose, face parsing (what workers/live-face/weights.py lists)
COPY weights.py /app/weights.py
RUN python /app/weights.py

# The face detector (S3FD) fetches its checkpoint on first use: do it at build so a cold worker never waits on it.
RUN python -c "import sys; sys.path.insert(0,'/app/MuseTalk'); from musetalk.utils.face_detection import FaceAlignment, LandmarksType; FaceAlignment(LandmarksType._2D, flip_input=False, device='cpu')" \
    && ls -la /root/.cache/torch/hub/checkpoints/

COPY handler.py /app/handler.py
CMD ["python", "-u", "/app/handler.py"]

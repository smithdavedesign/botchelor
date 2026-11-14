# Botchelor live-face worker, Ditto edition: Ant Group's Ditto talking head on TensorRT, on Runpod Serverless
# (workers/live-face-ditto/README.md). A second image beside the MuseTalk one (workers/live-face): Ditto's TensorRT
# engines need CUDA 12.1 / TensorRT 8.6.1 / Python 3.10, MuseTalk's stack needs CUDA 11.8 / torch 2.0.1, and the two
# don't share a base. Built for linux/amd64 by .github/workflows/live-face-ditto-worker.yml; the engines are baked in
# (~2 GB) so a cold worker needs no network volume and no data-center pin.
#
# The base image's cuDNN 8 is what TensorRT 8.6.1 links against; torch 2.5.1's pip wheels bring their own cuDNN 9
# beside it (different sonames, no conflict). Installing cuDNN 8 through pip instead would replace torch's.
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    DITTO_DIR=/app/ditto MODE_TO_RUN=serverless SOURCE_CACHE=/tmp/live-face-ditto

# python3.10-dev + build-essential: Ditto's blend step is Cython compiled on first import (pyximport); it's compiled
# here, at build, so a cold worker doesn't.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.10 python3.10-dev python3.10-venv python3-pip build-essential ffmpeg git ca-certificates curl \
      libgl1 libglib2.0-0 libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/local/bin/python

# Ditto at a pinned commit (the one the spike ran on 2026-11-14; Apache-2.0)
ARG DITTO_COMMIT=c3e47eee2e626500017a0556b470d6d4182f85e8
RUN git clone https://github.com/antgroup/ditto-talkinghead /app/ditto \
    && cd /app/ditto && git checkout ${DITTO_COMMIT} && rm -rf .git

WORKDIR /app/ditto
COPY requirements.txt constraints.txt /app/
# constraints.txt holds the pins every step below must keep (numpy 2.0.1 above all: the config pickles are numpy-2
# pickles, numba 0.60 is the last that takes numpy 2.0; TensorRT 8.6.1 is what the shipped engines were built with).
ENV PIP_CONSTRAINT=/app/constraints.txt
RUN python -m pip install --upgrade pip wheel "setuptools<81" \
    && python -m pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu121 \
    && python -m pip install tensorrt_libs==8.6.1 tensorrt_bindings==8.6.1 --extra-index-url https://pypi.nvidia.com \
    && python -m pip install --no-build-isolation tensorrt==8.6.1 --extra-index-url https://pypi.nvidia.com \
    && python -m pip install -r /app/requirements.txt

# Fail the build, not the first job, if the stack is inconsistent: numpy 2.0.1, TensorRT importable, the Cython blend
# compiled, and the pipeline module importable (it pulls in every component).
RUN python -c "import numpy, cv2, torch, tensorrt, librosa, soundfile, imageio_ffmpeg; from cuda import cudart; assert numpy.__version__ == '2.0.1', numpy.__version__; assert tensorrt.__version__.startswith('8.6.1'), tensorrt.__version__; import sys; sys.path.insert(0, '/app/ditto'); from core.utils.blend import blend_images_cy; import stream_pipeline_offline; print('stack ok: numpy', numpy.__version__, 'torch', torch.__version__, 'tensorrt', tensorrt.__version__, 'cv2', cv2.__version__)"

# Weights: the config pickles and the TensorRT engines built for Ampere and newer (workers/live-face-ditto/weights.py)
COPY weights.py /app/weights.py
RUN python /app/weights.py

COPY handler.py /app/handler.py
CMD ["python", "-u", "/app/handler.py"]

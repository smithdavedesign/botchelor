"""MuseTalk 1.5's weights into ./models (run from the MuseTalk directory). Their download_weights.sh calls commands
that newer huggingface_hub and gdown no longer have, so this is the same list through the hub's Python API."""
import os
import subprocess
import sys

from huggingface_hub import snapshot_download

JOBS = [
    ("TMElyralab/MuseTalk", "models", ["musetalkV15/musetalk.json", "musetalkV15/unet.pth"]),
    ("stabilityai/sd-vae-ft-mse", "models/sd-vae", ["config.json", "diffusion_pytorch_model.bin"]),
    ("openai/whisper-tiny", "models/whisper", ["config.json", "pytorch_model.bin", "preprocessor_config.json"]),
    ("yzd-v/DWPose", "models/dwpose", ["dw-ll_ucoco_384.pth"]),
]
for repo, d, pats in JOBS:
    print("->", repo, d, flush=True)
    snapshot_download(repo_id=repo, local_dir=d, allow_patterns=pats)

os.makedirs("models/face-parse-bisent", exist_ok=True)
if not os.path.exists("models/face-parse-bisent/79999_iter.pth"):
    subprocess.check_call([sys.executable, "-m", "gdown", "154JgKpzCPW82qINcVieuPH3fZ2e0P812", "-O", "models/face-parse-bisent/79999_iter.pth"])
if not os.path.exists("models/face-parse-bisent/resnet18-5c106cde.pth"):
    subprocess.check_call(["curl", "-sL", "https://download.pytorch.org/models/resnet18-5c106cde.pth", "-o", "models/face-parse-bisent/resnet18-5c106cde.pth"])

for p in ["models/musetalkV15/unet.pth", "models/sd-vae/diffusion_pytorch_model.bin", "models/whisper/pytorch_model.bin", "models/dwpose/dw-ll_ucoco_384.pth", "models/face-parse-bisent/79999_iter.pth", "models/face-parse-bisent/resnet18-5c106cde.pth"]:
    size = os.path.getsize(p) if os.path.exists(p) else 0
    print(f"{size:>12} {p}")
    if size < 1_000_000:
        sys.exit(f"missing or truncated: {p}")
print("WEIGHTS_OK")

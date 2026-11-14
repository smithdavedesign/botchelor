"""Ditto's config pickles and TensorRT engines (Ampere and newer) into ./checkpoints, from Hugging Face
(digital-avatar/ditto-talkinghead). Only the TensorRT path's files: the PyTorch and ONNX copies (another 2.4 GB)
aren't used by the worker."""
import os
import sys

os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")
from huggingface_hub import snapshot_download  # noqa: E402

REPO = "digital-avatar/ditto-talkinghead"
ENGINES = [
    "appearance_extractor_fp16", "blaze_face_fp16", "decoder_fp16", "face_mesh_fp16", "hubert_fp32",
    "insightface_det_fp16", "landmark106_fp16", "landmark203_fp16", "lmdm_v0.4_hubert_fp32", "motion_extractor_fp32",
    "stitch_network_fp16", "warp_network_fp16",
]
print("->", REPO, flush=True)
try:
    snapshot_download(repo_id=REPO, local_dir="checkpoints", allow_patterns=["ditto_cfg/*.pkl", *[f"ditto_trt_Ampere_Plus/{e}.engine" for e in ENGINES]])
except Exception as e:  # hf_transfer can refuse some networks; the plain downloader is slower but sure
    print("hf_transfer failed, plain download:", repr(e)[:200], flush=True)
    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"
    snapshot_download(repo_id=REPO, local_dir="checkpoints", allow_patterns=["ditto_cfg/*.pkl", *[f"ditto_trt_Ampere_Plus/{e}.engine" for e in ENGINES]])

total = 0
for p in ["checkpoints/ditto_cfg/v0.4_hubert_cfg_trt.pkl", *[f"checkpoints/ditto_trt_Ampere_Plus/{e}.engine" for e in ENGINES]]:
    size = os.path.getsize(p) if os.path.exists(p) else 0
    total += size
    print(f"{size:>12} {p}")
    if size < 10_000:
        sys.exit(f"missing or truncated: {p}")
print(f"{total:>12} total")
print("WEIGHTS_OK")

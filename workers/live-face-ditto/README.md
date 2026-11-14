# Live-face worker, Ditto edition (Runpod Serverless)

The show's second own renderer for companion calls (docs/PRDs/digital-human.md, "Ditto"; the server side is
`lib/live-face/ditto.ts`, the compare entry `ditto` in `lib/live-face/renderers.ts`). Where MuseTalk
(workers/live-face) paints a mouth onto the frames of a character's idle loop, Ditto (Ant Group,
github.com/antgroup/ditto-talkinghead, Apache-2.0; weights on Hugging Face, digital-avatar/ditto-talkinghead)
animates the whole head from one still: turns, brows, blinks, a smile forming, a mouth that opens on vowels, closes on
consonants and shows teeth. The spike that chose it (2026-11-14, Juniper's portrait on a rented 4090) measured the
TensorRT path at 1.3 s for a 2-s clause and 3.6 s for 5.6 s, the same speed as MuseTalk, with a whole-face result;
the PyTorch path was twice real time and is not used. The GPU is rented by the second, so there is no monthly plan.
Runpod's terms exclude adult content, so this serves PG calls only.

## Jobs

| op | input | output |
|---|---|---|
| `speak` | `source_url` or `source_b64` (a still: the kit's portrait or a frame of its loop; a video works but restarts at its first frame each clause), `audio_b64` (`audio_format` `pcm16` at `rate`, or `wav`), optional `fade_in`/`fade_out` (frames), `sampling_timesteps` (Ditto's default 50), `emo` (default 4) | `video_b64` (MP4, H.264 + AAC, the still's own size), `frames`, `fps` 25, `width`, `height`, `bytes`, `registrations` (cache hits), `ms` (`source`, `setup`, `audio`, `render`, `encode`, `total`) |
| `warm` | | `ok`, `ms` of the warm-up clause |

`speak` is `/runsync`. There is no `prepare`: Ditto registers a still in a fraction of a second (face detection,
landmarks, appearance and motion features), and the worker keeps the last `REGISTRATIONS` (16) registrations in
memory, so a call's clauses after the first skip it. Continuity between clauses is not a frame index as with
MuseTalk's `start_frame`: each clause starts from the still's pose and `fade_in`/`fade_out` ease the motion at the
ends. The first clause on a fresh worker pays TensorRT's first run (about 13 s); the worker does that itself at
start, in `warm`, on Ditto's sample portrait.

## Environment

- `MODE_TO_RUN`: `serverless` (the image's default) serves jobs; `pod` runs a self-test on `SAMPLE_DIR/portrait.png`
  (or `.webp`/`.jpg`) and `clause.wav` and writes to `SAMPLE_OUT` (how the handler is developed on a GPU pod).
- `DITTO_DIR` (`/app/ditto`), `DITTO_DATA_ROOT` (the engines), `DITTO_CFG_PKL`, `SOURCE_CACHE` (`/tmp/live-face-ditto`),
  `MAX_AUDIO_SECONDS` (30), `MAX_SOURCE_PX` (1024: a larger still is scaled down first), `REGISTRATIONS` (16).
- No object store: a still comes by URL (the show's own store or site) or inline, and the clip goes back inline.

## Build and deploy

1. Actions → "live-face ditto worker image" → run with a tag (`v1` → `ditto-v1`). It pushes
   `ghcr.io/smithdavedesign/botchelor-live-face:ditto-<tag>`: a tag of the SAME package as the MuseTalk worker, which
   is public, so Runpod pulls it without a registry credential. A push to a `live-face-ditto-*` branch that touches
   the worker builds `ditto-<run number>` instead (a fresh tag every build: Runpod caches an image per tag on each
   host). The image is CUDA 12.1 + cuDNN 8 (what TensorRT 8.6.1 links against), Python 3.10 (TensorRT 8.6.1's wheels
   stop at 3.11), torch 2.5.1 (its own cuDNN 9 beside the system's 8), TensorRT 8.6.1 from pypi.nvidia.com,
   cuda-python 12.6.2, numpy 2.0.1 (the config pickles are numpy-2 pickles; numba 0.60 is the last that takes numpy
   2.0), and the twelve `ditto_trt_Ampere_Plus` engines (2.0 GB; HuBERT alone 1.4 GB). `constraints.txt` pins what
   every pip step must keep; the Dockerfile compiles Ditto's Cython blend step and imports the pipeline at build, so a
   broken stack fails the build, not the first job. Ditto's ONNX detectors and mediapipe are not needed on the
   TensorRT path (every model in `v0.4_hubert_cfg_trt.pkl` is an engine).
2. Runpod (the setup key, `vault/botchelor/RUNPOD_ADMIN_KEY`): a template for the image (`MODE_TO_RUN=serverless`
   is baked in; no secrets needed) and a QUEUE endpoint on the same pools and scaling as the MuseTalk one
   (`ADA_24` + `AMPERE_24`, 0–3 workers, idle 60 s, QUEUE_DELAY 1, FlashBoot, 180-s timeout), with
   `gpu.minCudaVersion` 12.4 because cuda-python 12.6's runtime wants a recent driver. The endpoint keeps its own copy
   of the template's container settings, so a new build goes live by patching the endpoint's `image`
   (`PATCH /v2/serverless/<id> {"image": …}`); a stale idle worker on the old image still takes jobs until it idles
   out, so scale `workers.max` to 0 and back to retire it. The first endpoint, 2026-11-14: `k6mzbe6h1jgc19`, from
   template `6xcn8wmxzq` (image `ditto-1`); the show app points at it.
3. The show app: `LIVE_FACE_DITTO_ENDPOINT=<endpoint id>` beside `RUNPOD_API_KEY` and `LIVE_FACE_ENDPOINT`. The
   compare page (`/admin/live-face`) then lists `ditto`; calls keep MuseTalk until Ditto is wired into
   `liveFaceClips` (its continuity is motion state, not a frame index, and the between-clip loop should be
   Ditto-rendered too).

## Cost

The same as the MuseTalk worker: a 24 GB worker about $0.0125 a minute while it runs (the 4090 tier about $0.022),
only during a call plus the idle timeout; nothing while nobody calls. Both workers resident on one 24 GB card would
fit (Ditto 2.8 GB on TensorRT, MuseTalk ~6 GB), but they are separate images today. The spike that chose Ditto cost
$2.14 of pod time.

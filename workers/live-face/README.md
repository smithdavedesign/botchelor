# Live-face worker (MuseTalk on Runpod Serverless)

The show's own lip-sync renderer for companion calls (docs/PRDs/digital-human.md, Tier 1b; the server side is
`lib/live-face/musetalk.ts`). A character's face-kit idle loop (lib/face-kit.ts) is turned once into an avatar bundle;
on a call each clause of the companion's Aura voice comes back as a short MP4 of that loop with the mouth saying it.
MuseTalk 1.5 is MIT-licensed with weights free for commercial use; the GPU is rented by the second, so there is no
monthly plan. Runpod's terms exclude adult content, so this serves PG calls only.

## Jobs

| op | input | output |
|---|---|---|
| `prepare` | `id`, `loop_url` or `loop_b64` (MP4, 25 fps, a face in every frame), `bbox_shift` | `bundle_key` (in the show's object store under `live-face/<id>/`), `frames`, `width`, `height`, `fps`, `ms`, `loop` (what the re-timing did), `loop_key` (the re-timed loop in the store, or null) |
| `speak` | `bundle_key`, `audio_b64` (`audio_format` `pcm16` at `rate`, or `wav`), `fps`, `start_frame` | `video_b64` (MP4, H.264 + AAC), `frames`, `next_frame`, `cycle` (the idle cycle's length: the loop forward and back), `ms` |
| `warm` | | `ok` |

`prepare` is asked with `/run` and followed with `/status` (a minute or two: landmarks, crops, VAE latents and blend
masks for every frame of the loop). It first re-times a loop whose motion is slower than its frame rate: the kit's
loops are Wan renders at 16 fps in a 25-fps file (38% of Juniper's frames repeated the one before), and a mouth drawn
fresh on all 25 over a head that moved on 16 read as wrong. mpdecimate's defaults find exactly those repeats; the real
frames are spread at their own rate and `minterpolate` (mci, aobmc, bidir) fills the frames between: 127 → 124 frames,
all different, for the same five seconds, in about eight seconds of CPU. The re-timed loop goes to the store as
`loop_key`, and the show makes it the kit's loop too (lib/live-face collectLiveFaces). A loop without that pattern
passes through untouched (`SMOOTH_MIN_DUP`, 20% repeats). `speak` is `/runsync` (a second or two warm). `start_frame` lets a run of clauses
continue the idle motion: pass the previous clip's `next_frame`.

## Environment

- `MEDIA_S3_ENDPOINT`, `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`:
  the show's bucket (lib/object-store.ts), where bundles live. On Runpod these come from account secrets
  (`{{ RUNPOD_SECRET_… }}` in the template), never from the image.
- `MODE_TO_RUN`: `serverless` (the image's default) serves jobs; `pod` runs a self-test on `SAMPLE_DIR/loop.mp4` and
  `clause.wav` and writes to `SAMPLE_OUT` (how the handler is developed on a GPU pod, Runpod's golden path 09).
- `MUSETALK_DIR` (`/app/MuseTalk`), `BUNDLE_CACHE` (`/tmp/live-face-bundles`), `BATCH_SIZE` (20), `MAX_AUDIO_SECONDS` (30).

## Build and deploy

1. Actions → "live-face worker image" → run with a tag (`v1`). It pushes `ghcr.io/smithdavedesign/botchelor-live-face:<tag>`
   (~11 GB: torch, the OpenMMLab stack and the weights). A push to a `live-face-*` branch that touches the worker
   builds `dev-<run number>` instead: a fresh tag every build, because Runpod caches an image per tag on each host.
   The package is public (made so 2026-11-13); a private one needs a Runpod registry credential on the template.
   `constraints.txt` pins what every pip step must keep (numpy 1.23.5 above all: mmpose depends on `opencv-python`,
   whose current wheels want numpy 2, and xtcocotools can't load under it); the Dockerfile fails the build if the stack
   doesn't import.
2. Runpod (the setup key, `vault/botchelor/RUNPOD_ADMIN_KEY`; runpodctl lives in `~/.claude/botchelor-bin`). The
   template through runpodctl; the endpoint through REST v2, because runpodctl's `serverless create` still goes
   through GraphQL, which that key doesn't have (2026-11-13: a 401):
   ```sh
   runpodctl template create --name live-face-v1 --serverless --image ghcr.io/smithdavedesign/botchelor-live-face:v1 \
     --container-disk-in-gb 25 --env '{"MODE_TO_RUN":"serverless","MEDIA_S3_ENDPOINT":"…","MEDIA_S3_BUCKET":"…","MEDIA_S3_REGION":"…","MEDIA_S3_ACCESS_KEY_ID":"{{ RUNPOD_SECRET_MEDIA_S3_ACCESS_KEY_ID }}","MEDIA_S3_SECRET_ACCESS_KEY":"{{ RUNPOD_SECRET_MEDIA_S3_SECRET_ACCESS_KEY }}"}'
   curl -X POST https://api.runpod.io/v2/serverless -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' -d '{
     "name": "live-face", "type": "QUEUE", "templateId": "<template>",
     "gpu": {"pools": ["ADA_24", "AMPERE_24"], "count": 1},
     "workers": {"min": 0, "max": 3, "idleTimeout": 60}, "timeout": 180000,
     "flashboot": "FLASHBOOT", "scaling": {"type": "QUEUE_DELAY", "queueDelay": 1}}'
   ```
   Pools are the catalog's (`GET /v2/catalog/gpus`, field `pool`): `ADA_24` is the 4090, `AMPERE_24` the 3090, A5000
   and L4. A reply's clauses render in parallel, so the endpoint wakes a worker after one second of queue, up to
   three, and keeps them a minute across a call's turns (2026-11-14; request-count scaling would have been the fit,
   but Runpod gives it no idle timeout). No data-center pin and no network volume: the weights are in the image. The first endpoint, 2026-11-13:
   `rstlknto5x90ad`, created from template `59ipbcal95`. The endpoint keeps its own copy of the template's container
   settings (its `templateId` reads back empty), so a new build goes live by patching the endpoint itself, which makes a
   new release and every worker pull it (2026-11-14: `dev` → `dev-4` this way, old workers marked stale at once):
   ```sh
   curl -X PATCH https://api.runpod.io/v2/serverless/rstlknto5x90ad -H "Authorization: Bearer $RUNPOD_API_KEY" \
     -H 'Content-Type: application/json' -d '{"image": "ghcr.io/smithdavedesign/botchelor-live-face:<tag>"}'
   ```
   Worker logs need a key with more than the Serverless scope (`/v2/serverless/<id>/workers/<worker>/logs` answered
   403 to the setup key); to see a failing image's traceback, run it on a pod with `cmd` set to an sshd (the
   2026-11-13 debugging route, `scratchpad` scripts `pod-ssh.sh`) and start `handler.py` by hand in `MODE_TO_RUN=pod`.
3. The show app: `LIVE_FACE_PROVIDER=musetalk:admins`, `LIVE_FACE_ENDPOINT=<endpoint id>`, `RUNPOD_API_KEY` (the app's
   key, `vault/botchelor/RUNPOD_API_KEY`, Serverless endpoints only).

## Cost

A 24 GB worker bills about $0.0125 a minute while it runs (the 4090 tier about $0.022), only during a call plus the
idle timeout; a bundle is a few MB in the bucket; nothing while nobody calls. The spike that proved it (2026-11-13,
Juniper's loop on a rented 4090) cost under $2.

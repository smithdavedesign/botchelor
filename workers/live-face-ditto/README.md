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
| `speak` | `source_url` or `source_b64` (a still: the kit's portrait or a frame of its loop; a video works but restarts at its first frame each clause), `audio_b64` (`audio_format` `pcm16` at `rate`, or `wav`); the chain's `state_b64` (from the clause before), `want_state`, `fade_in`/`fade_out` (frames), `tail_silence_ms`; `emo` (Ditto's expression bank: 0 angry, 1 disgust, 2 fear, 3 happy, 4 neutral, 5 sad, 6 surprise, 7 contempt), `motion` (`{"kind": "sway"|"nod"|"tilt", "amount", "period_s", "at_s"}`: a pose on top of the audio, through Ditto's per-frame pose controls), `sampling_timesteps` (Ditto's default 50) | `video_b64` (MP4, H.264 + AAC, the still's own size), `frames`, `fps` 25, `width`, `height`, `bytes`, `state_b64` (when asked), `chain` (what the chain did), `handler` (the handler's version), `registrations` (cache hits), `ms` (`source`, `setup`, `audio`, `render`, `encode`, `total`) |
| `speak` with `stream: true` | the same inputs | a stream (`/run` + `/stream/<id>`): `{kind: "start", frames, width, height}`, `{kind: "state", state_b64}` the moment the motion step is done, `{kind: "frag", i, b64}` pieces of a fragmented MP4 (H.264 Main 3.1 + AAC, the voice muxed in, a piece every 200 ms or keyframe) as the frames render, `{kind: "end", frames, pieces, bytes, first_piece_ms, ms}` |
| `stream_probe` | a clause + `overlap_v2`, `sampling_timesteps`, `paced` | Ditto's ONLINE loop fed at a call's pace, per-frame lag (the experiment that showed continuous mode doesn't keep up on a 4090: 1.3–2.1× real time) |
| `warm` | | `ok`, `ms` of the warm-up clause |

The handler is a generator (Runpod streams every job) started with `return_aggregate_stream`, so `/runsync` and
`/status` answer the plain ops' one result as a one-item list; `lib/live-face/ditto.ts` reads either shape. `speak` is
`/runsync`; streamed `speak` is `/run` then `/stream/<id>` polled every 150 ms (`runStream` in lib/live-face/musetalk.ts).
The streamed form is what calls use when the browser can play fragments (it says so with `frags: true` on the turn;
`LIVE_FACE_FRAGS=0` on the show app turns it off): the chain's next clause is queued the moment this one's state is
out, so the clause-to-clause gap goes, and a clause's first frames leave the worker ~0.4 s after its voice is in
instead of after the whole clip. Measured on the endpoint (2026-11-14, warm): the 5.64-s clause's state at 1.6 s from
submission, first fragment at 2.1 s, end at 4.6 s (19 pieces); 1.88-s clauses state ≈ 0.9 s, first fragment ≈ 1.4 s.
On production in Chrome: a clause's start 0.26 s after its voice ended, its first fragment 1.4 s after. There is no `prepare`: Ditto registers a still in a fraction of a second (face detection,
landmarks, appearance and motion features), and the worker keeps the last `REGISTRATIONS` (16) registrations in
memory and a still fetched by URL for `URL_CACHE_S` (15 min), so a call's clauses after the first skip both. The
first clause on a fresh worker pays TensorRT's first run (about 13 s); the worker does that itself at start, in
`warm`, on Ditto's sample portrait.

**The chain.** Continuity between a reply's clauses is not a frame index as with MuseTalk's `start_frame` (there is no
idle cycle); it is motion state carried through the job, because a chain's clauses may land on different workers
(`lib/live-face/ditto.ts` DittoChain drives it):

- the first clause starts at the still (Ditto's relative motion makes frame 0 the still itself) and `fade_in` (6)
  frames ease the motion in;
- a clause asked with `want_state` answers `state_b64`: its last `TAIL_FRAMES` (10, Ditto's own window overlap)
  motion frames, the conditioning frame before them, the 0.4 s of audio under them (int16) and the chain's reference
  frame `d0`, about 35 KB;
- the next clause sends it back: the motion tail seeds Ditto's window `_fuse` (the model continues the motion rather
  than restarting it), the audio tail is prepended so HuBERT has its context (those 10 frames are generated again and
  not output), `d0` keeps the whole chain relative to the same still (else each clause would re-zero to its own first
  frame: a jump), and the first `JOIN_BLEND` (5) output frames ease from the clause before's last rendered frame;
- the last clause gets `tail_silence_ms` (400) of silence appended, which the lips close on, and `fade_out` (13) frames
  (`fade_type` "s" over pose and expression) that bring it back to the still, so the browser hands over to the kit's
  loop at its first frame, the portrait, with no jump.

The chain's loop is `_chain_audio2motion_offline`, Ditto's own `_audio2motion_offline` at the pinned commit with the
state around it, bound onto the SDK instance at import.

**The library.** The same `speak` renders a character's idle and reactions once (lib/live-face/ditto-clips.ts): silence
as the audio, a `motion` on top (`sway`: a slow small drift of pitch, yaw and roll for an 8-s idle; `nod`: one pitch
pulse of 4.5° over 0.6 s; `tilt`: a 4° roll with a little yaw, ramped and held), fading in from and out to the still
so each clip loops or cuts against the portrait, `emo` neutral. On a call a clause's `emo` comes from its words
(lib/live-face-shared.ts `emoFor`): a laugh or warmth is spoken in the happy bank, a gasp in surprise, sorrow in sad.

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
   TensorRT path (every model in `v0.4_hubert_cfg_trt.pkl` is an engine). Ditto's Cython blend step is built in place
   by `build-blend.py` for x86-64-v2: its own `blend.pyxbld` compiles with `-march=native` on first import, and the
   binary pyximport built on GitHub's runner died with "Illegal instruction" on Runpod's EPYC hosts (every `ditto-3`
   worker unhealthy; traced on a pod with `python -X faulthandler`). The build check asserts the prebuilt module is
   the one imported.
2. Runpod (the setup key, `vault/botchelor/RUNPOD_ADMIN_KEY`): a template for the image (`MODE_TO_RUN=serverless`
   is baked in; no secrets needed) and a QUEUE endpoint on the same pools and scaling as the MuseTalk one
   (`ADA_24` + `AMPERE_24`, 0–3 workers, idle 60 s, QUEUE_DELAY 1, FlashBoot, 180-s timeout), with
   `gpu.minCudaVersion` 12.4 because cuda-python 12.6's runtime wants a recent driver, and `gpu.excludedTypes`
   `["NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb"]` (sent together with `gpu.pools`): Runpod put those
   slices in the 24 GB pools on 2026-11-15 and the TensorRT 8.6 Ampere+ engines can't load on Blackwell (every job
   failed with `'NoneType' object has no attribute 'set_input_shape'`). The endpoint keeps its own copy
   of the template's container settings, so a new build goes live by patching the endpoint's `image`
   (`PATCH /v2/serverless/<id> {"image": …}`); a stale idle worker on the old image still takes jobs until it idles
   out, so scale `workers.max` to 0 and back to retire it. The first endpoint, 2026-11-14: `k6mzbe6h1jgc19`, from
   template `6xcn8wmxzq` (image `ditto-1`); the show app points at it.
3. The show app: `LIVE_FACE_DITTO_ENDPOINT=<endpoint id>` beside `RUNPOD_API_KEY` and `LIVE_FACE_ENDPOINT`. The
   compare page (`/admin/live-face`) then lists `ditto`, and `LIVE_FACE_PROVIDER=ditto` (or `ditto:admins`, or `ditto:plan` for admins and Companion Plan members) puts
   calls on it: a character with a face kit has a Ditto face at once (nothing to build), a reply renders as one
   chain of clips (above), and a person can pick it for their own calls on the compare page whatever the server's
   setting (`user_live_face`). The browser (app/companion/[id]/LiveFace.tsx) plays the clips as it does MuseTalk's,
   holds a clip's last frame for a moment when the next piece's clip is a beat late (rather than drop to the loop
   mid-motion), and restarts the loop at its first frame after a reply (`end_frame` 0).

## Measured

On a secure 4090 pod from the image (2026-11-14), Juniper's kit portrait (512², WebP) and the sample Aura clause
(5.64 s): engines loaded in 2.7 s; the warm-up clause (1 s of silence on Ditto's sample portrait) 2.2 s, of which
1.2 s was the first registration; then the clause → 141 frames in 3.16 s (registration 44 ms, HuBERT 149 ms, motion +
render 2.85 s, mux 94 ms; 303 KB), and the same clause again in 3.10 s with the registration a 6-ms cache hit. That is
0.55× real time, MuseTalk's speed, with the whole head moving.

On the endpoint (`k6mzbe6h1jgc19`, 2026-11-14 16:43 UTC, a warm worker): a job is picked up in 23–30 ms and the same
5.64-s clause takes 3.6–3.75 s on the worker (render 3.3 s, 0.59×), 4–5 s wall from a laptop with the 300 KB clip; a
fresh worker's warm-up is 12.8 s (the first TensorRT run) and shows as "initializing" to the endpoint, not as a
failed job. A chain renders one clause after another (each needs the one before's state), each in about 0.6× its
length plus the job round trip, so it keeps ahead of its own playback when clauses are a couple of seconds long
(lib/live-face-shared.ts `clausesOf` keeps them so). On production (2026-11-14 evening, warm worker): the first clip of
a reply 1.6–3.2 s after its clause's voice ended, the next before the first finished. A cold worker takes 22–32 s to
boot, so the first reply of a cold call plays plain (the browser's 4-s hold) and the next gets clips; the endpoint's
idle timeout is 180 s so a call's pauses don't cool it. The library (image `ditto-7`, `motion`): the 8-s idle 200
frames in 4.2 s, the nod 1.0 s, the tilt 1.2 s; the first call for a character shares the worker with its library
render, so that one reply's clips ran about a second late.

## Cost

The same as the MuseTalk worker: a 24 GB worker about $0.0125 a minute while it runs (the 4090 tier about $0.022),
only during a call plus the idle timeout; nothing while nobody calls. Both workers resident on one 24 GB card would
fit (Ditto 2.8 GB on TensorRT, MuseTalk ~6 GB), but they are separate images today. The spike that chose Ditto cost
$2.14 of pod time.

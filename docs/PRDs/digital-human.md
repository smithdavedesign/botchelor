# Digital humans: bringing a character's face to life on a call

**Status:** Tier 0 built and live (#1529, 2026-11-13). Tier 1 has two renderers behind `LIVE_FACE_PROVIDER`, both
off by default: Simli's adapter (built 2026-11-13; its faces need a paid plan, which David hasn't taken) and **our own
renderer, MuseTalk on Runpod** ([Tier 1b](#tier-1b-our-own-renderer-musetalk-on-runpod-serverless), built the same
day after David asked for a pay-as-you-go way and proved on a rented GPU with Juniper's loop), **live on botchelor.com
for admins since 2026-11-14** (#1544, #1566; a real admin call with Juniper returned lip-synced clips on desktop and
phone, screenshots at the top of the README). The GPT-written proposal this answers is
`Botchelor_Digital_Human_Engine_PRD.docx` beside this file; this page is the review of it and what we're doing
instead, in order of value per dollar.

## What the proposal asked for

A live chest-up face for each character: natural motion, lip sync, two-way voice over WebRTC, "transparent"
presentation with fallbacks, a provider-independent module inside the app, Tavus Phoenix 4.5 benchmarked first,
HeyGen LiveAvatar second, Simli as an extra, in 17–26 engineering days.

## What we already had (checked in the repo, 2026-11-13)

- **Two-way voice is live.** Companion live calls (docs/companions.md, P6): the browser streams the microphone to
  Deepgram Nova-3, the reply streams back in clauses, each PG- and crisis-checked, voiced by Aura-2 as 24 kHz PCM,
  with barge-in and an echo filter, billed by the minute (20 a month with the plan, then 1 token per 10). About a
  second to first audio, about 2¢ a minute. The proposal's "one conversation authority" is this pipeline already.
- **The visitor sees a still round portrait** during the call. That was the whole gap.
- **Faces that move exist on After Dark only** (`lib/adult/presence.ts`): a head-and-shoulders portrait, seven
  expression stills, a 5-second idle loop; `LivingFace.tsx` shows the line's expression. Nothing on the PG side.
- **Lip-synced clips are offline only:** Wan 2.2 S2V on Replicate ($0.02 a second of video, about 65 s to render)
  and Wan 2.6 talking shots. Minutes, not real time.
- **Identity:** portraits are `character_assets` rows (kind `portrait`, approved, `content_rating`), not columns on
  `characters`. Voices are a deterministic pick by pronouns and id (`auraVoiceFor`); nothing is stored.
- **Hosting:** DigitalOcean App Platform, Node servers, SSE only. No WebRTC or WebSocket server. Any live renderer has
  to do its own WebRTC from the browser.
- **The Mac can't render faces:** nothing (LivePortrait, MuseTalk, SadTalker, Kokoro) is installed, and Wan
  image-to-video runs at about 8 minutes per second of video there. The proposal's "FLUX/Qwen/Kokoro locally" don't
  exist locally; they're Replicate and Venice models.
- **Earlier call:** docs/PRDs/theater-immersion.md row 10 parked "a live call" because hosted avatar providers ban
  adult content (Tavus AUP §4.9).

## Verdict

The skeleton is sound (a typed provider adapter, versioned profiles per portrait, server-minted session credentials,
explicit start, per-session metering, fallbacks) and we keep those ideas. The first candidate is wrong, the
transparency plan is a fantasy for every candidate, and the estimate is about three times what's left to build.

| Correction | Why |
|---|---|
| **Tavus can't be first.** | Its acceptable-use policy bans adult content (Botchelor is 18+ even on the PG side); Tavus's docs say background customisation (the green screen) isn't available on Phoenix-4.5 faces; a 30-second minimum per call; $0.26–0.37 a minute, four to five times what a call minute earns. |
| **HeyGen LiveAvatar is a comparison at most.** | Avatar-only mode about $0.09 a minute (over our revenue a minute); no server-side alpha, chroma-key a green stream in a canvas; HeyGen's help centre won't help with photo-avatar backgrounds. |
| **Simli is the fit, not the extra.** | About $0.009–0.01 a minute for rendering; 50 free minutes a month; a face from one photo (preprocess → create → poll); a browser SDK that takes our own PCM16 16 kHz audio (`sendAudioData`, `handleSilence`, `ClearBuffer` on a barge-in). Known weak point: idle and listening motion. To verify in the spike: its terms for an adult-themed platform, background options, minting a session token server-side, concurrency on the cheap plans. |
| **Anam is the backup benchmark.** | One photo, bring your own LLM and voice, 30 free minutes, $12 a month for 50, overage $0.11–0.16 a minute. Only if Simli's identity or idle behaviour fails review. |
| **No live provider ships real alpha.** | Plan on chroma-key in a canvas, or a designed round frame, from day one. The proposal's "native alpha" mode doesn't exist for any candidate. |
| **Pin the voice when a face is made.** | Today it's a hash of pronouns and id; a pronoun edit changes it. The kit should remember its Aura voice (Tier 1). |
| **The identity source is the approved portrait asset.** | Plus After Dark's `adult_presence` portrait where one exists; never new columns on `characters`. |
| **After Dark stays parked.** | Every hosted renderer bans adult output; "fictional adult" doesn't change their terms. After Dark keeps presence and expressions. Only PG companion calls (and later PG show dates) get a live face. |
| **Effort.** | The conversation layer exists, so the proposal's M3 collapses. Tier 0 took a day; the Simli spike and ship is four to six. |

## Cost a call minute (list prices, November 2026; verify on the vendor pages before signing up)

| Layer | $/min | Note |
|---|---|---|
| Deepgram Nova-3 + Aura-2 (today) | ~0.02 | measured, docs/companions.md |
| **Tier 0 living face (ours)** | **0.00** | about 26¢ once per character: seven Qwen edits (~3¢) and one Wan 2.2 clip at 480p (~5¢) |
| Simli | ~0.01 | 50 free min/month; plans about $10–49/month |
| Anam | 0.11–0.16 | free 30 min; $12/month for 50 |
| HeyGen LiveAvatar (avatar only) | ~0.09 | chroma-key only |
| LemonSlice | 0.16–0.22 | bills idle time |
| Tavus CVI | 0.26–0.37 | AUP bans adult; 30-s minimum |
| D-ID | 0.35–0.50 | |
| **A call minute earns** | **~0.07** | 1 token (~68¢) per 10 minutes after the plan's 20 |

Tier 0 plus Simli is about 3¢ a minute against about 7¢ earned. Everything else loses money a minute at our prices.
The only new spend is a Simli plan (David's, capped, the key under `vault/botchelor/SIMLI_API_KEY`); Tier 0 spends a
few dollars of Replicate credit once per character, a few a day at most.

## Best in class, in order of value per dollar

Kindroid's and Character.AI's sense of presence comes from layering, not from one video stream.

1. **A face that moves with the voice we already stream** (Tier 0, built): the portrait; a breathing, blinking loop
   while they listen; the mouth that fits how loud the voice is right now (closed, parted, open, rounded), read off
   the same audio the call plays; a blink now and then; a smile or a gasp when the line calls for one. Zero a minute,
   works on phones, and the honest fallback for ever.
2. **Real lip-synced video** (Tier 1, Simli) swapped in over the same round frame when the plan allows and the device
   can, so the change is invisible, and Tier 0 the moment it fails.
3. **A scene, not a bust:** the venue behind the face (we have the backdrops), a place sound bed (After Dark has
   them; PG would make its own at about 5¢ a place), captions as the existing transcript.
4. **Consent and controls** already in the call: the microphone only after a tap, Mute, Interrupt, End.

## Tier 0: the face kit (built)

`lib/face-kit.ts`, `lib/face-kit-shared.ts`, `app/companion/[id]/LiveFace.tsx`, table `face_kits`.

- **Made once per approved safe portrait** (the newest `character_assets` portrait rated pg, or a house character's
  reviewed file): the kit's own portrait (collarbones up, mouth closed) edited from it with Replicate's Qwen image
  edit (the After Dark settings' `replicate_keyframe_model`, its safety checker on), then six stills edited from
  that portrait: lips parted, mouth open, lips rounded, eyes closed, a smile, a gasp. Each still passes the PG check
  (`checkRating`: plainly clothed, adults) before it's kept, at 512 px as WebP. The loop is Wan 2.2 image-to-video
  at 480p from the portrait (`replicate_video_model`), queued, and kept once three of its frames pass the same check
  (`/api/face-kit` carries ffmpeg for that, next.config.ts).
- **Who starts it, who pays:** nobody per use. A kit is drawn when an account with the plan (or an admin) starts a
  call, live or taking turns, with a character that has none (`ensureFaceKit`): at most `FACE_KIT_PER_DAY` (12) across
  everyone, four an hour, and a failed kit isn't retried on a call for a day. An admin draws or redraws one any time
  with `POST /api/admin/face-kit {character_id}`. A guest's call draws nothing. A new approved portrait means a new
  kit; the old one shows until the new is ready. (David, 2026-11-13: payment gates are my call.)
- **On the call:** `LiveFace` stacks the stills and fades between them. While they talk, the mouth follows the
  player's `level()` (the RMS of what's playing through one analyser: the live PCM, or the file a taking-turns call
  plays); when the device's own speech synthesis talks there's nothing to measure, so made-up syllables move the
  mouth. The loop plays while they listen or the call is paused, and fades back into the portrait before it restarts
  so the seam never shows; it stays off with reduced motion. A blink lands every 2.5–6 s while the loop isn't doing
  the blinking. A line that laughs or gasps shows that look for 1.8 s. No kit, or one that can't talk yet: the round
  Avatar as before. A kit being drawn arrives part by part: the page polls `GET /api/face-kit?character=` every 15 s
  while the call is on.
- **Served** by `GET /api/face-kit/<id>`: a part never changes once ready, so it's cached for a year, and goes out
  with the AI-generated mark like every drawn picture.
- **Counted:** `face_kit` in the log (stills made, loop queued, failures, the cost estimate, time); never a picture.
- **Tests:** `tests/face-kit.test.ts` (Replicate and the PG check faked; a real clip for the frames),
  `tests/face-kit-shared.test.ts` (the mouth, the looks, the synthetic syllables).

## Tier 1: a real-time renderer (next)

What Simli's own pages say (read 2026-11-13; simli.com/pricing, /legal/terms-of-service, docs.simli.com):

- **Plans:** Free $0 (50 min/month, 1 session, template faces only, no custom face); Hobby $10 (1,000 min, 2 sessions,
  **1 custom face a month**); Pro $49 (5,500 min, 10 sessions, **5 custom faces a month**); Scale $249 (27,500 min, 50
  sessions, 25 faces). So the free tier can't try our faces, and a three-character spike needs Pro for one month
  (or Hobby for three months).
- **A custom face** (Trinity-2, `POST /faces/trinity/preprocess` then `/faces/trinity`, poll `generation_status`):
  JPEG/PNG/WebP under 5 MB, at least 512×512, facing the camera, head at least 15% of the height; framed waist-up
  with the torso and hands. **It takes about four hours to build**, builds on one account start at least ten minutes
  apart, and a failed build uses no credit. New accounts get Trinity-2 only.
- **A session:** the server mints a token with `POST /compose/token` (header `x-simli-api-key`; `faceId`,
  `maxSessionLength` 3600 s, `maxIdleTime` 300 s, `handleSilence`, `audioInputFormat` pcm16, a `background_id`,
  streaming size from 512 px); the token lives five minutes and is all the browser gets. `FACE_NOT_ALLOWED` for a face
  another account owns.
- **Terms:** no ban on an 18+ platform and nothing on dating or companion apps. "Don't build tools that may be
  inappropriate for minors: sexually explicit or suggestive content" rules out After Dark, not plainly dressed PG
  faces. Facial recognition is barred (we do none). **Simli takes a perpetual, royalty-free licence to uploaded content
  "for training of AI Models"**: fine for the show's own characters; a creator's own character goes up only with
  their yes (a sentence on the kit's button). Users must be 18+. Cancelling ends access to the faces made.

What's built (same day): `lib/live-face/simli.ts` (faces, status, sessions, nothing else), `lib/live-face/index.ts`
(the registry: `live_faces`, build by an admin, collect on the kit route's poll, a session at a live call's start when
on for the person), `lib/live-face-shared.ts` (our 24 kHz PCM to the renderer's 16 kHz pieces), `LiveFace.tsx` (the
stream over the kit's face, the voice fed to it, Tier 0 back the moment it fails), `companion_live_calls.face_*` for
the spend view, `/api/admin/live-face`. Tests: `tests/live-face.test.ts`, `tests/live-face-shared.test.ts`.

The plan, with those in:

1. **Spend:** Simli **Pro, $49 for one month** (five faces, 5,500 minutes), created by David, capped at the plan
   price; key `vault/botchelor/SIMLI_API_KEY` via `~/ai-stack/bin/secrets add --cap "$49/month"`. Down to Hobby ($10,
   one new face a month, 1,000 minutes) once the cast's faces exist, or off if the spike fails.
2. **Spike (two days, because a face takes four hours):** three characters (photoreal, a different look, anime) as
   Trinity-2 faces from the kit's own portrait (which already fits the specs: facing the camera, head large, 512 px);
   feed recorded Aura audio through `simli-client`; judge identity, idle behaviour, time to first video, the round
   frame over a plain `background_id`; the same three on Anam's free tier for comparison. Results go in this file as
   the decision record.
3. **Adapter:** `lib/live-face/provider.ts` (`capabilities`, `createFace`, `mintSession`, `endSession`,
   `verifyWebhook`), `lib/live-face/simli.ts`, chosen by `LIVE_FACE_PROVIDER` (`off` by default). The server mints the
   five-minute session token at call start (and again on a reconnect); the browser gets only that. The provider's face
   id, its build state and version live on `face_kits` (a face is built once per kit portrait, hours before any call
   can use it; until then the call is Tier 0).
4. **Client:** when a session carries a provider token, `LiveFace` mounts the Simli client over the same round frame,
   resamples Aura's 24 kHz PCM to 16 kHz PCM16 (`toPcm16`), sends each clause, clears the buffer on a barge-in (which
   `liveStep` already signals), and drops back to Tier 0 on any error within 3 s.
5. **Metering and caps:** `companion_live_calls` gains `face_provider`, `face_seconds`, `face_usd_est`; Deepgram and
   Simli join `/admin/spend`'s provider readings; a daily cap `LIVE_FACE_MAX_MINUTES_DAY`; rollout like
   `COMPANION_LIVE` (admins first).
6. **Proof:** Playwright screenshots of a live call with a moving face, desktop and phone, in `docs/screenshots/`.

## Tier 1b: our own renderer (MuseTalk on Runpod Serverless)

David, 2026-11-13, when Simli's faces turned out to need a $49 plan: "is there other solutions that are pay as you go?"
and then "can we try self-hosted MuseTalk on RunPod serverless?". What the market looked like that day (vendor pages,
read 2026-11-13): no hosted live-face vendor sells true pay-as-you-go at the low end; every one is a subscription with
overage on top. Simli Hobby $10/month (one face a month, 1,000 min); bitHuman $20/month plus $1 per 100 credits (2 a
minute self-rendered, $5 a face, no bring-your-own-audio web SDK); Anam ($12 + 16¢/min) and Beyond Presence (€49) ban
"adult entertainment" and promoting "dating services"; HeyGen LiveAvatar $99; D-ID ~35¢/min; LemonSlice from $8 but
14–22¢/min with idle billed. The only metered option is a GPU rented by the second with an open model on it.

**The spike (2026-11-13, pod `bz-musetalk-dev`, RTX 4090 secure at $0.89/h, under $2 in all):** MuseTalk 1.5 (MIT,
weights free for commercial use; `TMElyralab/MuseTalk@0a89dec`) with Juniper's face-kit idle loop as its only
reference and one Aura clause. The lips followed the words, the teeth looked like hers, the pasted mouth region had no
visible edge at 624 px; the loop's own blinks and head motion carried through (the proof page, private:
https://claude.ai/artifact/W3Zcfg52W3RWEN3fiGJ4jj). Numbers from the worker's own self-test on the pod: models load in
9 s; a bundle (landmarks, crops, VAE latents, blend masks for 127 frames) in 37 s; a warm 5.6-s clause in 3.7 s
(audio features 10 ms, render 2.7 s ≈ 52 fps, encode 0.9 s); the first clause on a cold worker paid 4.7 s of Whisper
warm-up, which the worker now does at start. Setting up the environment cost three tries (new setuptools dropped
`pkg_resources`, which `mim` imports; `chumpy` needs pip at build time; MuseTalk's `download_weights.sh` calls
`huggingface-cli` and `gdown --id`, both gone), all folded into the image.

**What's built (same day):**

- `workers/live-face/` (handler.py, Dockerfile, weights.py, README): a dual-mode image (Runpod's golden path 09):
  `pod` runs a self-test, `serverless` serves `prepare` (loop → bundle in the show's object store, asked with `/run`),
  `speak` (one clause's PCM → MP4 with the voice in it, `/runsync`, from `start_frame` so clause after clause continues
  the idle cycle) and `warm`. CUDA 11.8 + torch 2.0.1 + the OpenMMLab stack, weights baked in (~11 GB), built by
  `.github/workflows/live-face-worker.yml` to `ghcr.io/smithdavedesign/botchelor-live-face:<tag>`.
- `lib/live-face/musetalk.ts` (the only code that talks to Runpod: `RUNPOD_API_KEY`, the app's key with Serverless
  endpoints only, and `LIVE_FACE_ENDPOINT`), `lib/live-face/index.ts` now a registry of two (`LIVE_FACE_PROVIDER` =
  `simli[:admins]` | `musetalk[:admins]`; a MuseTalk face is a `live_faces` row whose `provider_face_id` is the
  Runpod job while building and the bundle's key once ready; `liveFaceClips` for a turn), `liveFaceSession` answers
  `{provider: "musetalk", px: 624}` and warms a worker.
- The turn stream: after each piece's `audio_end` the server asks the worker for the clip and sends it as a `video`
  event (`video_fail` when it can't), one after another; `done` waits for them.
- The browser (`LiveFace.tsx`, `CompanionCall.tsx`): with a MuseTalk session each piece's voice is held for its clip
  (`CLIP_HOLD_MS`, 4 s after the voice finished arriving) and the clip plays over the kit's face in the same round
  frame, voice included; a piece whose clip fails or is late plays the plain way with the kit's mouth moving to it;
  the idle loop keeps playing under and between clips. A barge-in drops the clips. The face's element is unlocked by
  the call's first tap so phones let the clips play with sound.
- Runpod: the account holds the two object-store secrets (`MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`) the
  template references; the endpoint has no network volume and no data-center pin.

**Cost:** a 24 GB worker bills about $0.0125 a minute while it runs (the 4090 tier $0.022), only during a call plus
the idle timeout (30 s); a bundle is 3.5 MB in the bucket; nothing while nobody calls. Against ~7¢ a minute earned.

**Scope:** Runpod's terms of service list "pornography or graphic adult content" as unauthorized, so this serves PG
companion calls only; After Dark keeps Tier 0. Anime faces will likely fail MuseTalk's face detector and stay on
Tier 0 too (the build says so: `no face found`).

**Live proof (2026-11-14 UTC, endpoint `rstlknto5x90ad`, image `dev-4`):** once the package was public the first
worker booted, `warm` passed and every `prepare` failed: the image had numpy 2.2.6, not the pinned 1.23.5, because
mmpose depends on `opencv-python`, whose current wheels need numpy 2, and xtcocotools (mmpose's COCO tools) is
compiled against 1.x ("numpy.dtype size changed"); `warm` never imports mmpose, which is why it passed. Found by
running the same image on a pod with an sshd as its command (the endpoint's worker logs answer 403 to both of our
keys) and fixed with `workers/live-face/constraints.txt` on every pip step plus a build-time import check (#1566).
The same night two Dependabot security bumps (diffusers 0.38, transformers 5.10) had been auto-merged into the
worker's pins and made the image unbuildable; pins restored, `.github/dependabot.yml` leaves that directory alone.
Numbers from the live endpoint: a worker that has the image starts in 22–32 s (a host that doesn't pulls 9.3 GB
first, ~9 min, once); `warm` 44 ms; Juniper's bundle (127 frames) 22.3 s, 3.5 MB; a 5.6-s clause 4.6 s (features
23 ms, bundle load 196 ms, render 3.2 s, encode 1.0 s) with 22 ms of queue when warm; the clip is 624² H.264 at
25 fps with the voice in AAC, 866 KB. On production the admin route built Juniper's face in 31 s, and in the proof
call (Playwright driving Chrome, the microphone and Deepgram's socket faked, everything else real) the first clip
started 0.2 s after the reply's first words on desktop, 4.0 s after the visitor's line; on the phone 4.5 s after the
line, before the transcript line had rendered, and the second clip followed 2 s after the first ended.

**Realism pass (2026-11-14, David: "the mouth is super unnatural in the live call with Juniper. What's going on?"):**
three things, measured on a captured turn (scratchpad `capture-turn.mjs` keeps the clips and voice pieces a real
turn streams):

1. *Two mouths in one reply.* The browser held each piece's voice 4 s for its clip; the clips of a two-piece reply
   came 4.2 s and 5.4 s after their voice ended (the server asked for a clip only once a whole piece's voice was in,
   and rendered the pieces one after another), so pieces fell back to the kit's still-mouth at random, after a
   four-second silence, with the head jumping at every clip edge because the idle loop underneath played on
   regardless. Now the server renders every piece's clip the moment its voice is in, all at once, each starting in
   the idle cycle where the one before ends (the frame count is known from the voice's length: `framesOfPcm`), and a
   long first sentence goes as two pieces split at a clause (`splitFirstPiece`) so the first clip is ready sooner.
   The browser decides once per reply: the first piece's clip within `CLIP_HOLD_MS` (4 s) makes it a clip reply, in
   which every piece waits for its clip (`CLIP_LATE_MS`, 8 s) and plays in order through two video elements that
   hand over frame to frame; late or failed, and the whole reply plays the plain way and its clips are dropped. The
   kit's loop pauses under a clip and takes over where the last clip left off (`loopTimeAtCycleFrame`: the cycle runs
   the loop forward then back, so the handover is at worst a turn, never a jump).
2. *A 16-fps head under a 25-fps mouth.* The kit's loop is a Wan render at 16 fps in a 25-fps file: 38% of its
   frames repeat the one before, so the head stuttered at 16 Hz while MuseTalk drew a new mouth on all 25. The
   worker now re-times such a loop before building the bundle (mpdecimate finds exactly the repeats, 127 → 79;
   minterpolate fills real frames between them, 124 even frames for the same five seconds) and stores the re-timed
   loop, which becomes the kit's loop too (`collectLiveFaces`), so the living face is smooth as well. Kit loop URLs
   now carry `?v=<updated_at>` because the file route caches for a year.
3. *MuseTalk's own mouth.* Small movements, little jaw, a soft pasted region. Its one knob, the mouth-box shift,
   made no visible difference on Juniper at +8, +14 or -6 (openness range 21–28 on the same clause), so it stays 0
   (`LIVE_FACE_BBOX_SHIFT` sets it for new faces). The clip's audio and length are exact (a 2.72-s piece is 2.72 s
   of video with its own waveform), so sync is not the issue; what's left is the renderer's ceiling, and the next
   step past it is a different model (LatentSync or a Wan talking-head pass per clause, both slower) if the first
   two fixes don't carry it.

**Realism pass, measured after it all landed (2026-11-14 06:00–06:40 UTC, #1572 #1574 #1575 #1576 #1577 #1578 #1579;
proof calls on botchelor.com with the stream and the face logged):**

| | before (02:50 UTC) | after |
|---|---|---|
| First clip after the visitor's line | 4.0–4.5 s, or none (both clips of a two-piece reply missed the 4-s hold) | 3.5–5.3 s on six calls, always together with the first words; 1.8–3.2 s after the first piece's voice ended |
| Clip to clip | one after another: 2-s gaps between sentences | handovers frame to frame; 0.3–0.7-s gaps when a 4- or 5-piece reply outran the two warm workers (the endpoint now wakes a worker after a second of queue, up to three, kept a minute) |
| Two mouths in one reply | yes, at random | never: a reply is clips or the plain mouth; with the clips hidden from the page (`DROP_VIDEO=1` in the proof) Dex's reply played plain at 4 s with the kit's five stills cycling and the loop stepped aside |
| Head under the mouth | 16-Hz stutter under a 25-Hz mouth; 1.56× too fast in clips (the kit loops are native 16 fps, 81 frames) | 124 even frames at 25 fps for both the clips and the kit's loop, at the loop's own speed |
| Pieces | the writer's sentences, whole | clauses of about two seconds (`clausesOf`, 44 characters); a very short opener folded into the next piece |

What's left is MuseTalk's own mouth (small, soft) and the model's time to its first words (1.1–1.3 s of the total).

## Renderer compare and BYOK (2026-11-14, David: "build a bunch of top models out and allow the user to BYOK… admin for now, then compare")

One interface, `ClipRenderer` (lib/live-face/renderers.ts): prepare nothing (the kit's portrait and loop are the face), speak a
clause (the Aura audio in; an MP4 out, with the time it took and an estimated cost). Behind it:

| Renderer | Kind | Runs on | What it does |
|---|---|---|---|
| `musetalk` | live | our Runpod worker | what calls use today |
| `fal:sync-lipsync-2`, `fal:latentsync`, `fal:kling-lipsync` | batch | fal.ai | a mouth onto the kit's own loop: the like-for-like comparison with ours |
| `fal:infinitalk`, `fal:omnihuman` | batch | fal.ai | whole head from the portrait: the ceiling |
| `replicate:wan-2.2-s2v` | batch | Replicate | the reels' talking-shot model, from the portrait |
| `did:talks` | batch | D-ID | from the portrait, on a D-ID key |
| `simli` | stream | Simli | listed for completeness; a stream, not a clip |

**The compare** (lib/live-face/compare.ts, `/admin/live-face`): pick a character with a kit and a line; the line is voiced
once in their Aura voice, the WAV kept and served to the providers at `/api/live-face/audio/<uuid>.wav`; every chosen renderer
gets the same kit and audio; the clips land as they finish (the page polls), each with its render time, its estimated cost and
a 1–5 rating that accumulates per renderer across compares. Keys: the admin's own Connection for a provider when they have one,
else the house key (fal and Replicate from the After Dark provider keys; D-ID has no house key).

**BYOK** (lib/connections-shared.ts): a new job, `live_face`, with fal.ai and D-ID as new providers and Replicate joining it;
the renderers are the job's "models". fal's key check is a cancel of a request that doesn't exist (404 with a good key, 401 with
a bad one, nothing spent); D-ID's is its credits endpoint. Nobody but admins sees the compare; the job card shows on
/account/keys like the others.

**A person's renderer for their own calls** (`user_live_face`, `/api/me/live-face`, the "Your calls" box on the compare page):
auto (the server's), MuseTalk clips, or the Simli stream, honoured by `liveFaceSession` and `liveFaceClips` when that
renderer has a ready face for the character and a key. A Simli face on a person's own key is the next step (faces are per
account at Simli).

**Vendors read for an 18+ platform (2026-11-14, scratchpad `vendor-terms.md`):** LemonSlice is the one real-time vendor whose
terms fit (no adult, dating or 18+ clause; avatars "of a person or character"; your own PCM in over WebSocket, video into your
LiveKit/Daily room; $8/month for 41 min then 22¢/min, concurrency 3, idle billed; no alpha). HeyGen LiveAvatar fits technically
(your PCM in, ~9¢/min) but its terms bar third parties from using a customer's key and its moderation policy reserves sole
discretion over anything sexual. D-ID's terms refuse "pornography publishers"; a fallback at best. Hedra's real-time avatar was
shut down in April 2026. Tavus, Anam and Soul Machines are out (consent video of a real person, a dating/adult ban, enterprise).
None gives alpha; the round frame makes that moot.

**First compare, Juniper, "Found a new draft in the lantern room. It hums. I think it's trying to tell me something."
(4.5 s of voice; botchelor.com, 2026-11-14 07:00–07:45 UTC, house keys; three runs because the fal client first cut the
nested models off, #1584 #1585):**

| Renderer | Time to the clip | Cost of the clause | Output | My read of the frames (ratings are David's) |
|---|---|---|---|---|
| MuseTalk (ours) | 2–3 s warm, 33 s with a cold worker | ≈0.15¢ | 624² 25 fps, our loop | the mouth is small and soft; the only one a call can use today |
| Sync lipsync-2 (fal) | 82 s | fal's price | 624² 25 fps, our loop | quiet, closed-ish lips, little more than ours |
| LatentSync (fal) | 4.5 min | fal's price | 624² 25 fps, our loop | a slightly crisper MuseTalk: teeth show more often |
| Kling lipsync (fal) | 2.4 min | fal's price | 624² 30 fps, our loop | the best mouth onto our own loop: round vowels, open shapes, our head motion kept |
| OmniHuman (fal) | 2.0 min | fal's price | 1088² 25 fps, from the portrait | the strongest whole face: expressive, identity held, sharp |
| InfiniteTalk (fal) | 10.7 min | fal's price | 640² 25 fps, from the portrait | lively head and eyes, strong articulation; slow |
| Wan 2.2 S2V (Replicate) | 3.4 min | 9¢ | 512² 16 fps, from the portrait | very expressive, but 16 fps and a different crop |

What it says: for a call, nothing hosted is within an order of magnitude of the two-second budget; for anything rendered
ahead of time (a date replay in the theater, a showcase reel, a video reply), OmniHuman and Kling-over-our-loop are the two
to put behind the pre-rendered surfaces, Kling when the loop's framing must stay, OmniHuman when the whole face may move.
David's point (2026-11-14): "might be a case for using a more slow model if we are replaying a date, but for live chat
latency matters" is exactly that split, and the `ClipRenderer` interface is what lets a replay call a slow one while calls
keep the fast one. fal's per-clause prices weren't on its OpenAPI; the bill says.

### Ditto (2026-11-14): the spike and the second worker

Ant Group's Ditto (github.com/antgroup/ditto-talkinghead, Apache-2.0; weights digital-avatar/ditto-talkinghead) is the open
equivalent of what the hosted real-time vendors run: a diffusion motion model drives a LivePortrait-style warp of ONE still,
so the whole head moves. Spiked on a rented 4090 (Juniper's portrait, Aura clauses of 2 s and 5.6 s; full report with the
install recipes in `workers/live-face-ditto/SPIKE.md`).

**Verdict: clearly better than MuseTalk, and real time on TensorRT.** From the portrait it turns and tilts the head, moves
the brows, blinks, lets a smile form and fade, and the mouth opens wide on vowels, closes on consonants and shows teeth;
MuseTalk's same clause is a small soft mouth on a fixed head. Identity holds; slight diffusion smoothing; a few frames with
smeared teeth; no edge artefacts at 512 px.

| Path | 2-s clause | 5.6-s clause | GPU memory | Load |
|---|---|---|---|---|
| PyTorch, steady state | 4.1 s (2.1× real time) | 10.9–12.2 s | 4.7 GB | 5.3 s |
| TensorRT, shipped Ampere+ engines, warm | 1.30–1.33 s (0.65×) | 3.56 s (0.63×) | 2.8 GB | 2.7 s, first call +13 s |

TensorRT's output is visually the same as PyTorch's, and 0.65× real time is MuseTalk's own render speed (0.57×): a 2-s
clause ≈ 1.3 s render + our ~1 s of overhead ≈ 2.3 s to the first clip, inside the 4-s hold. Ditto's online (streaming) mode
as shipped is not usable (it wrote 85 of 141 frames and 0 for the short clause; it needs its own flush handling). Gotchas
that cost the spike time: PyPI's `onnxruntime-gpu` is a CUDA-13 build (HuBERT silently ran on CPU: first call 98 s), TensorRT
8.6.1 needs Python ≤ 3.11 and cuDNN 8 beside torch's cuDNN 9, uv's build isolation breaks `tensorrt_libs`. The pod ran
2.4 h at $0.89/h ≈ $2.14 and was deleted the same day.

**Built the same day:** `workers/live-face-ditto/` (CUDA 12.1 + cuDNN 8 base, Python 3.10, torch 2.5.1, TensorRT 8.6.1,
numpy 2.0.1, the twelve engines baked in; jobs `speak` and `warm`, registrations cached per still; pushed as a `ditto-<n>` tag
of the same public GHCR package; endpoint `k6mzbe6h1jgc19`), `lib/live-face/ditto.ts` (`LIVE_FACE_DITTO_ENDPOINT`, same `RUNPOD_API_KEY`) and the
`ditto` renderer on the compare page, so it sits in the same table as the seven above on the same line and face.
Proved on a 4090 pod from the image: engines in 2.7 s, Juniper's 5.6-s clause in 3.16 s (0.55× real time; registration
44 ms, then a 6-ms cache hit), 141 frames at 512². One trap on the way: Ditto's Cython blend step compiles with
`-march=native` on first import, so the binary built on GitHub's runner hit an illegal instruction on Runpod's EPYC hosts
and every worker came up unhealthy; the image now builds it for a portable target (`build-blend.py`).

**What moving calls onto it takes (next):** Ditto has no idle cycle to index, so continuity between a reply's clauses is
motion state, not MuseTalk's `start_frame`: carry the last clause's pose into the next (`ctrl_info`, `fade_in`/`fade_out`),
and render the between-clip loop with Ditto too (a silent clause) so the renderer never visibly changes. Feed the 624-px
loop frame rather than the 512-px portrait so clips match the round frame without upscaling. Then `LIVE_FACE_PROVIDER=ditto:admins`
through the same `liveFaceClips` path. Both renderers resident on one 24-GB card would fit; they are two images today.

**Latency:** a clause's clip arrives roughly two seconds after its voice (render ≈ frames at 50 fps + encode); the
browser holds the voice for it (measured above: the first clip and the first words start together). Simli is nearer one second end to end. If the hold reads as a pause, the next steps
are rendering in shorter pieces, `ultrafast` x264 or a smaller clip, and Runpod's WebSocket load-balancing endpoint
for a continuous stream (golden path 17).

## Not doing

Tavus, HeyGen, D-ID or LemonSlice as the first provider (cost and terms above); an After Dark live face (every
provider's terms, Runpod's included); our own GPU fleet (a worker rented by the second is not one); rendering on the
Mac (16 GB, no CUDA); a WebSocket or WebRTC server on DigitalOcean; browser segmentation of a provider's stream in v1.

## Open with David

- PG show dates (two faces on the theater stage) after companions, or companions only for now?
- Should a creator be able to draw their own character's kit from the companion page (free with the plan, as the
  call does, or priced like After Dark's presence)?

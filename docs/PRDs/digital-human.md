# Digital humans: bringing a character's face to life on a call

**Status:** Tier 0 built (PR "Living face", 2026-11-13). Tier 1 (a hosted real-time renderer) is a spike next, with
David's go on the spend. The GPT-written proposal this answers is `Botchelor_Digital_Human_Engine_PRD.docx` beside this
file; this page is the review of it and what we're doing instead, in order of value per dollar.

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

## Not doing

Tavus, HeyGen, D-ID or LemonSlice as the first provider (cost and terms above); an After Dark live face (provider
terms); our own GPU fleet; rendering on the Mac; a WebSocket or WebRTC server on DigitalOcean; browser segmentation of
a provider's stream in v1.

## Open with David

- PG show dates (two faces on the theater stage) after companions, or companions only for now?
- Should a creator be able to draw their own character's kit from the companion page (free with the plan, as the
  call does, or priced like After Dark's presence)?

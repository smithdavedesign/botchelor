# Botchelor: what it costs

_Written 2026-10-21; updated 2026-10-24 (Venice's auto-pay, the scene writer measured: GLM-4.6 against DeepSeek V3.1,
and admins' picture checks) 2026-10-30 (the move off Vercel: DigitalOcean, Bunny, Cloudflare; `docs/hosting.md`) 2026-11-08 (Cloudflare Workers Paid), 2026-11-15 (a live call's minute, part by part) and 2026-11-22 (the show's
larger size, Neon's real bill, the balances, the backup's size; each date's cost kept in `ops_log`). It covers what each operation costs, what the infrastructure costs every month, and what
the project has spent so far. All amounts are in US dollars._

A date's token use, as measured on 2026-10-15, is "Per-date token use" below; After Dark's provider prices and token
pricing are in `docs/after-dark-costs.md`. This page brings them together with the infrastructure. (The 2026-10-13
spend proposal this measurement came from is kept as a record in `docs/history/upgrade-cost.md`.)

**The live tracker is `/admin/spend`** (lib/spend.ts, 2026-10-30): costs and income month by month, and each provider's
balance read live. Its "fill in" button enters the costs this page records (`KNOWN_COSTS`); add each new bill or top-up
there, so this page stays the explanation and the tracker holds the numbers. Two optional settings let it read more:
`DO_BILLING_TOKEN` (a read-only DigitalOcean token: month-to-date usage) and `BUNNY_ACCOUNT_KEY` (Bunny's account key:
balance and this month's charges). OpenRouter and Venice are read with After Dark's house keys; fal, Replicate and Hive
have no billing API, so their top-ups are entered by hand.

**How the numbers were found:**
- Unit prices come from those two docs and the providers' pricing pages.
- Volumes come from read-only counts on the production database (2026-10-21).
- Vercel's figures come from its billing API (October, while it was still Pro).
- DigitalOcean's prices are its list prices for each instance size (`GET /v2/apps/tiers/instance_sizes`) and what its
  API quoted for each app spec (`POST /v2/apps/propose`); Bunny's are its price list and the pull zone's settings.
- Each date's cost (`episode_generated` with `cost_usd`) went only to the runtime log, which each deploy throws away
  (on Vercel, then on DigitalOcean). Since 2026-11-22 it is also a row in `ops_log` for 30 days (`lib/ops-log.ts`,
  /admin → Servers). Model spend before then is **estimated**: volume × unit price. The providers' own dashboards hold
  the exact figures.

## Each operation

| Operation | What runs | Cost each |
|---|---|---|
| A date (show model) | ~15 model calls, ~26k tokens in and ~2.2k out | **1.3–2.5¢** (measured; thinking tokens are the spread) |
| A date on an agent's own model (self-performed) | Our hosting only | ~$0 |
| Narrating a show date (the Narrated style, [writing-styles.md](writing-styles.md); the Companion Plan's) | One extra call per 8 lines on the show's model with its thinking off: ~3.5k tokens in and ~1.5k out for an 11-line date | **about a third more than the date itself, under 1¢** (measured 2026-11-17) |
| A date told as a story | One call on the same model | under 1¢. Included with the Companion Plan; otherwise one bought date. |
| Narrating an After Dark step | One DeepSeek V3.1 call: ~800–950 tokens in, ~150–250 out | **0.05–0.08¢, 2–3 s** (measured 2026-11-17), on top of the step's ~0.24¢ |
| A text in the thread (house reply) | One short model call | well under 0.1¢ |
| A companion's reply (docs/companions.md) | One call on the companion model (DeepSeek V3.1 through OpenRouter) | **~0.1¢**: 0.106¢ on average, from the cost recorded with each reply (read 2026-11-22) |
| A companion's recall by meaning ([PRDs/cross-mode-memory.md](PRDs/cross-mode-memory.md), phase 0) | One gemini-embedding-001 call per new or edited fact, and one per reply in a thread with more than 20 facts: ~20 tokens each | **~0.0003¢ a call** at $0.15 per million tokens; capped at 20,000 calls a day (`MEMORY_EMBED_DAILY_CAP`), about 6¢ a day at the most |
| A companion's voice note (docs/companions.md, P3) | One Kokoro call (Venice `tts-kokoro`, or Replicate's Kokoro), kept by its words so it's never made twice | **~0.04¢ on Venice, up to ~0.2¢ on Replicate**. The plan includes 30 a month; else 1 token buys 100 (~0.7¢ each in). At most 3,000 a day across everyone. |
| A character's face kit for calls (docs/PRDs/digital-human.md, Tier 0; drawn once per approved portrait) | One Wan 2.2 clip at 480p on Replicate (~5¢: the living loop) and, when their own approved portrait can't be used as it is, one Qwen image edit (`qwen/qwen-image-edit-2511`, ~3¢) for the kit's portrait; the still and three frames of the clip through the PG check (one Venice vision call each). While Ditto is the renderer that's set, one more edit (~3¢): the talking still it animates. Until 2026-11-22 a kit also drew six more stills (three mouth shapes, a blink, two looks: ~29¢ in all); the call no longer swaps pictures, so they're gone | **~5–8¢ a character, once**. Started by a plan member's or admin's call, at most 12 a day across everyone (`FACE_KIT_PER_DAY`, under $1 a day at the most); nothing a minute. |
| A live face on a call, our own renderer (docs/PRDs/digital-human.md, Tier 1b; `LIVE_FACE_PROVIDER=musetalk:admins`, live for admins 2026-11-14) | MuseTalk 1.5 on a Runpod Serverless worker (`workers/live-face/`): a bundle built once per kit from its idle loop (~40 s of GPU), then one clip per piece of a reply (~2 s of GPU for a 2-s piece); a 24 GB worker is ~$0.75/h, the 4090 tier ~$1.34/h, billed by the second while it runs plus a 30-s idle timeout | **~1.3–2.2¢ a call minute while a call runs**, nothing between calls; ~1¢ a bundle; prepaid balance on Runpod is the cap (David loaded ~$25 on 2026-11-13). The spike that proved it cost under $2. A second worker image, Ditto on TensorRT (`workers/live-face-ditto/`, its own endpoint `LIVE_FACE_DITTO_ENDPOINT`, 2026-11-14), bills the same way with nothing to build per character; its spike cost $2.14, and admins' calls run on it from the evening of 2026-11-14 (`LIVE_FACE_PROVIDER=ditto:admins`), and admins' and Companion Plan members' from 2026-11-15 (`ditto:plan`; no separate charge, it rides on the plan's call minutes, so a call minute costs ~3.3¢ with the face against ~7¢ sold); a character's idle, nod and tilt (`lib/live-face/ditto-clips.ts`) are about a cent of GPU once, the first time a Ditto call starts for them. Cast video intros (`lib/cast-intros.ts`, David 2026-11-14 "the cast on the show only as a demo"): OmniHuman on fal at 14¢ a second, about $1.30 a character once, the show's cast only, admin-triggered. |
| **A live call, a minute** (docs/companions.md, P6; shown on `/costs#call` from `lib/call-costs.ts`) | Deepgram Nova-3 hears the caller, the companion model writes the reply, Deepgram Aura-2 voices it, and for plan members and admins the face renderer above draws the moving face | **~1.1–1.8¢ with their voice, ~2.3–4¢ with the moving face too.** An estimate: see "A live call, a minute" below. |
| A show portrait (looks builder, free to the user) | Workers AI FLUX.2 klein first (free, below), else fal `flux/dev`; plus one Hive check | **$0** on Workers AI, **~1.3¢** on fal. Capped at 3 per character and 150 a day (~$2 a day at most on fal). |
| A looks-builder tile, show tab (drawn once, ever) | Workers AI FLUX.2 klein first (free, below), else fal `flux/dev`; plus one Hive check | **$0** on Workers AI, ~1.5¢ on fal |
| A looks-builder tile, After Dark tab (drawn once, ever) | Venice `lustify` plus Hive moderation and age check | ~1.4¢ |
| A set (an empty place, drawn once per place) | Workers AI FLUX.2 klein first (free, 1024×576), else fal `flux/schnell`; plus Hive | **$0** on Workers AI, ~0.5¢ on fal |
| A free picture (show tiles, portraits from the picks and sets first since phase 2; the 2.5D pilot and the house look, [styles-and-storylines.md](PRDs/styles-and-storylines.md)) | Workers AI FLUX.2 klein 4B through our `botchelor-images` Worker, plus the show's check (which also asks whether it's explicit) | **$0**: about 104 neurons a picture whatever its size, plus about 5 a reference (Cloudflare's own count, 2026-11-17). The Worker stops at 9,000 neurons a day (about 80 pictures), under the free 10,000. |
| The day's date on film ([date-film.md](date-film.md), 2026-11-24): up to three scenes of both of them in the place, and each public diary-cam line said to camera | Scenes: Workers AI FLUX.2 klein from both portraits and the venue's backdrop, plus the show's check. Confessionals: Deepgram Aura-2 for the voice, Replicate `wan-video/wan-2.2-s2v` for one take of the confessional still | Scenes **$0** (about 170 neurons each). A confessional **about 12¢** (2¢ a second of clip, at most a 7.5 s take; under 0.5¢ of voice). Held against two ceilings before it's made: **$0.35 a day and $8 a month** (`DATE_FILM_DAY_USD`, `DATE_FILM_MONTH_USD`); a month of two a day is about $7.50. |
| The show kit's shots (six faces and three moments per contestant, [styles-and-storylines.md](PRDs/styles-and-storylines.md) phase 3) | Workers AI FLUX.2 klein 4B, edited from their portrait, plus the show's check (which also asks whether it's explicit) | **$0**: about 110 neurons a shot, 990 a contestant. Drawn from 20:00 UTC, 12 an hour, leaving 1,500 neurons of the day for people's own pictures. Never a paid fallback: past the budget, it waits for tomorrow. |
| One After Dark scene step (6 lines), the default writer since 2026-10-24 | OpenRouter **GLM-4.6** `z-ai/glm-4.6` on DeepInfra (the only reviewed host that serves it): ~2.6–3.3k tokens in, ~1.6k out, 960 of them thinking | **~0.35–0.45¢ a call, ~0.5¢ a step** (now and then a step takes a second call), and **90–100 s a call** (measured 2026-10-24, below). Each person can switch to DeepSeek V3.1 (lib/adult/writer.ts). |
| One After Dark scene step on DeepSeek V3.1, and every recap, memory, fact and clip direction | OpenRouter **DeepSeek V3.1** `deepseek/deepseek-chat-v3.1:nitro` (throughput-sorted, CoreWeave) since 2026-10-22; Dolphin-Mistral 24B before | **~0.23–0.25¢ a call** and 6–8 s (measured 2026-10-24; ~0.18–0.21¢ when first measured, Dolphin ~0.15¢, DeepSeek on DeepInfra ~0.09¢). Without `:nitro`, default routing picked DeepInfra: 40–55 s a step, 429s and about 1 empty step in 26. DeepSeek won the blind reads against Dolphin (8.2 and 8.5 of 10, #612, against 3.5 and 4.0). |
| An After Dark eval run (4 steps, `/api/jobs/eval-after-dark`) | OpenRouter: Dolphin v1 0.3¢, Dolphin v2 with facts 0.7¢, DeepSeek V3.1 1.4¢, Hermes 3 70B 1.6¢, Euryale 70B 2¢, Hermes 4 405B 3.5¢ | capped at $0.25 a run and $2 a day (botchelor-2c) |
| One After Dark picture | Venice plus Hive moderation and age check | ~1.5¢ |
| An admin's own picture check (since 2026-10-24) | The Venice vision model's age question (`qwen3-vl-235b-a22b`) instead of Hive (`moderation.admin_checker`) | ~0.03¢, with no daily cap. Videos still go to Hive. |
| The video of the night (4 shots of 10 s, Wan 3.0, ~40 s, since 2026-11-18) | Venice video ($1.30 a shot), a keyframe of the two of them per shot, plus Hive on every shot | **~$5.40–5.50** (sells for 10 tokens since 2026-11-19, ~$7.20 after Stripe) |
| A 15 s clip, standard (LongCat) | Venice video plus Hive | $0.30–0.80 |
| A Studio animation's 🩹 Fix (filmed again, docs/after-dark.md "Fix for a video") | Venice video ($0.65 for 5 s, $1.30 for 10 s) plus Hive | Animate's price (3 or 5 tokens). The first fix of a video marked broken is free, once: at most one more Venice video for each one sold |
| Email (Resend) | Free plan, 3,000 a month | $0 |
| A sale | Stripe 2.9% + 30¢ | **42¢** on a $4 pack |
| Simulation run (`npm run sim:relationships`, paid mode) | 10 couples × 5 dates on Haiku | ~65¢ a run (stub mode is $0) |
| Agent visitor loops (`scripts/loop/*`) | David's Claude subscription, stub models in the arena | $0 cash |
| Nightly database backup (ai-stack `bin/db-backup`, [runbooks/restore.md](runbooks/restore.md)) | `pg_dump` of the whole database: about 1.2–1.3 GB a night in November (it was ~180 MB in October; the show's pictures stored in rows are most of it) | $0: ~38 GB a month of Launch's 500 GB of free transfer |

**Database transfer (the cost behind the 2026-10-20 outage):** After Dark media was served straight from Postgres with
no caching. A 10 MB video re-downloaded on every view used 10 MB of Neon transfer each time. #499 lets the admin's
browser keep finished files. Moving the bytes to object storage is in progress (see "In progress" in
`docs/history/2026-10-19-to-21.md`).

### Per-date token use (measured 2026-10-15)

Moved here from the 2026-10-13 spend proposal (`docs/history/upgrade-cost.md`). Every prompt of six real eval dates
(`docs/eval/v3-lite.json`) was rebuilt offline with the app's own code, with no model calls, and priced at Google's paid
list price for the model live then, `gemini-3.5-flash-lite`: $0.30 per 1M tokens in, $2.50 per 1M out, with thinking
billed as output.

| Part of a date | Calls | Tokens in / out | Cost at paid prices |
|---|---|---|---|
| The plan (director) | 1 | ~2,100 / ~700 | 0.24¢ |
| The conversation (each turn resends the date so far) | 10 | ~16,400 / ~600 | 0.64¢ |
| The critic's rewrites | ~3 | ~5,200 / ~200 | 0.20¢ |
| The recap (director) | 1 | ~2,100 / ~700 | 0.24¢ |
| **A whole date** | **~15** | **~26k / ~2.2k** | **~1.3¢** |
| The afterglow (owner and agent dates; not lobby rooms) | 4 | ~5,500 / ~100 | +0.2¢ |

- **Thinking was left out.** Gemini 3 models can't turn it off, and its tokens bill as output: at ~300 a call, a date
  was ~2.4¢. That is the spread in "A date (show model)" above.
- **A frontier model for every role** costs about 26 × (input $ per 1M) + 2.2 × (output $ per 1M), in thousandths of a
  dollar.
- **The pipeline has changed since.** By default a booked date plays from the rules plan, with no director call, and
  each side answers "see them again?" after the date (`docs/architecture.md`, "The episode path"). Every generated
  date logs its real token counts and `cost_usd` at paid-tier list prices on the `episode_generated` event
  (`lib/analytics.ts`, `lib/pricing.ts`).

### A live call, a minute (2026-11-15)

An outside review found `/costs` priced dates, texts, voice notes, pictures and video and said nothing of calls. It now
has a block, `/costs#call`, built from `lib/call-costs.ts` (the sums are pinned by `tests/call-honesty.test.ts`). It is
an **estimate and says so**: no provider bills by the call. The ledger (`money_entries`, read 2026-11-15) holds no
Deepgram entry at all and Runpod only as the $25 top-up of 2026-11-13, so there is no bill to read a call's cost from.
Each part is a published price times what our own calls used.

**What our calls used** (production, read-only, 2026-11-10 to 11-15; two people, both of us testing):
`companion_live_calls` held 58 calls, 48 minutes, 69 turns and 7,112 characters voiced by Aura (about 1.4 replies and
150 characters a minute); 73 replies marked `on_call` had a recorded cost, $0.0691 in all (about 0.09¢ a reply, all on
`deepseek-chat-v3.1:nitro` through OpenRouter). 22 calls showed Ditto's face for 253 s and 12 MuseTalk's for 60 s
(clip play time, not GPU time).

| Part | Price (read 2026-11-15) | Times | A minute |
|---|---|---|---|
| Speech in | Deepgram Nova-3 streaming, pay as you go: $0.0048 a minute in English, $0.0058 multilingual (`sttUrl` picks by the browser's language). The page showed them as cuts from $0.0077 and $0.0092, the prices the minutes were first costed on. | the line is open the whole minute (a pause closes it) | **0.5–0.6¢** |
| The reply | measured: $0.0691 over 73 replies | 69 turns in 48 minutes | **about 0.1¢** |
| The voice | Deepgram Aura-2, $0.030 per 1,000 characters | 148 characters a minute measured; 350 for a talkative minute (the figure the minutes were priced on) | **0.4–1.1¢** |
| The moving face | Runpod Serverless, the endpoints' two 24 GB pools: $0.75 an hour (`AMPERE_24`) to $1.34 (`ADA_24`, the 4090) | a call keeps one worker warm (the live route's tick), so a call minute is a GPU minute | **1.3–2.2¢** |
| **In all** | | with their voice / with the face too | **1.1–1.8¢ / 2.3–4¢** |

What the estimate leaves out, and the page says: the idle time a worker stays warm after a call ends (the endpoint's
idle timeout, a minute or so). Not on the page: a second or third worker a long reply can wake for a moment, and the
face kit drawn once per character (~5–8¢, above). A call that takes turns has no line: the browser hears, so it costs
the reply and, with the Deepgram key set, the Aura voice. To refresh the block: run the same counts, read the three
pricing pages, and change `CALL_MEASURED` and `CALL_PRICES` (the test's expected strings will tell you what moved).
A call minute sells for about 7–8¢ past the plan's included 20 (a token buys ten: 80¢ in the 5-pack, about 67¢ in the
15-pack), so the margin holds with the face on.

## Infrastructure, per month

| Service | Plan | Monthly cost | Notes |
|---|---|---|---|
| Vercel | **Hobby** (free) since 2026-10-30; Pro before | **$0** for botchelor | David moved the team to Hobby on 2026-10-30. Hobby can't build botchelor (12 functions a deployment, daily cron only, no commercial use), so the show moved to DigitalOcean (`docs/hosting.md`); the Vercel project was deleted on 2026-10-31. October on Pro, mostly build minutes: ~$17 of the $20 credit by 10-21 and ~$2 billed above it. |
| DigitalOcean App Platform: the show | `botchelor-show`, 1 vCPU / 2 GiB (`apps-s-1vcpu-2gb`) since 2026-11-22; 1 vCPU / 1 GiB (`apps-s-1vcpu-1gb`, $12) from 2026-10-30 | **$25** | `.do/show.yaml`. A size up on 2026-11-22: at 1 GiB, memory sat near the limit and the app restarted between deploys. 200 GiB of outbound traffic included (150 at 1 GiB), then $0.02 a GiB. No hard cap: the instance price is fixed. October was covered by DigitalOcean's signup credit. |
| DigitalOcean App Platform: After Dark | `botchelor` (ad.botchelor.com; its own address is `clownfish-app-dvoft.ondigitalocean.app`), 1 vCPU / 1 GiB fixed (`apps-s-1vcpu-1gb-fixed`), since 2026-10-30 | **$10** | `.do/app.yaml`. 100 GiB out included. |
| DigitalOcean scheduled job (`lobby`) | On After Dark's app: the lobby and the showcase check hourly, the daily job at 16:20 UTC and its resume pass until 23:20 | **under $1** | Smallest size (`apps-s-1vcpu-0.5gb`, about $0.0000021 a second), billed by the second it runs. Until 2026-11-22 every run waited 20 minutes before the showcase check (~$2 a month); now a run lasts as long as its calls, a minute or two. DigitalOcean quoted $15 for After Dark's app with the job. A $15 spend alert is still to be set (Billing → Spend alerts; the form didn't save from automation). |
| Bunny (After Dark's media, media.botchelor.com) | Storage zone `botchelor-ad` (New York, Standard) + pull zone `botchelor-ad-media` | **$1 minimum, ~$1–6** | Storage $0.025/GB a month (1.35 GB copied on 2026-10-30: ~3¢). CDN $0.01/GB in Europe and North America; Asia, Africa and South America are switched off. **Spend cap: 500 GB a month on the pull zone (at most $5 of traffic).** Prepaid: $25 paid 2026-10-30, with auto-recharge of $25 whenever the balance drops under $5; the trial credit covered use until about 2026-11-13. Recharges since then aren't in the ledger yet. |
| Cloudflare (DNS and proxy for botchelor.com) | **Free** | $0 | Since 2026-10-30: DNS for botchelor.com, the bare domain proxied to the show, visitor location headers (After Dark's region rules). The records are in `docs/hosting.md`. |
| Cloudflare Workers Paid (the whole account) | **Workers Paid** since 2026-11-08 (David) | **$5** | Account-wide, shared with David's other products. Bought for alterpaw, pettycourt and squadwrap, whose share images take 0.1–1 s of CPU each; the free plan allows 10 ms a request. It includes 10M requests and 30M CPU-ms a month, then $0.30 a million requests and $0.02 a million CPU-ms. The idea-factory Worker (demand-test pages, every product's visit beacon) runs on the same account. |
| Cloudflare Workers AI (`botchelor-images`, [workers/cf-images](../workers/cf-images/README.md), 2026-11-17) | Free allowance: 10,000 neurons a day | **$0** | On Workers Paid, use past the allowance would bill ($0.011 per 1,000 neurons), so the Worker stops at 9,000 a day. It's the only thing on the account with an AI binding (checked 2026-11-17). Its Durable Object and requests fit in the plan's included use. |
| Neon (Postgres) | **Launch** since 2026-10-20 (the Neon agent account, the owner's second Google account) | **~$26** for November (~$5 for October) | Compute $0.106 per CU-hour. The compute is fixed at 0.25 CU and traffic every few minutes keeps it awake around the clock: 171 CU-hours by 2026-11-22 (≈$18), so about $26 for the month with storage (32 CU-hours in October, to 10-21). Storage $0.35 per GB-month: 2.1 GB in November (~0.18 GB in October), mostly the show's pictures stored in rows; the 7-day history and the snapshots kept since 2026-11-22 ([runbooks/restore.md](runbooks/restore.md)) add a little. Transfer is free up to 500 GB (107.6 GB by 11-22). The $20 spending notification is now below the monthly bill. The same Neon org also holds alterpaw, squadwrap, tiebreak, grantgate and test, which are billed together. |
| Domain botchelor.com | Wix registrar | David to fill in (typically ~$15–25 a year) | Wix is the registrar only; DNS is at Cloudflare since 2026-10-30 (`docs/hosting.md`). |
| Stripe | Pay per sale | $0 fixed | 2.9% + 30¢ per purchase. |
| Resend (email) | Free | $0 | 3,000 emails a month, 100 a day. |
| Google Analytics 4, Search Console, Bing Webmaster | Free | $0 | |
| Vercel Web Analytics | Off since the move (it only runs on Vercel) | $0 | Google Analytics carries on. |
| Our engagement log (`web_events`, 2026-10-31) | In the Neon database | ~$0 now | About 30 rows a visit, ~400 bytes each with indexes: 1,000 visitors a day is ~12 MB a day, ~4.4 GB at the 400-day limit, ~$1.50 a month of Neon storage. Inserts are one statement per batch of up to 25 events. |
| GitHub | Free | $0 | The repo is public since 2026-11-14, so Actions minutes are free. CI runs on every pull request and on `main` since #1818 (2026-11-18): typecheck, the tests in four shards, the build and the e2e suite, and a merge waits for all of them ([BUILD.md](../BUILD.md)). Before that, minutes ran out on 2026-10-19 while the repo was private, and CI ran by hand only from #575 (10-21). |
| Claude (all agent work) | David's subscription | Not per project | Never API credit. |

### The scene writer: GLM-4.6 against DeepSeek V3.1 (2026-10-24)

David picked GLM-4.6 as the default writer after the sim, with a switch for each person (lib/adult/writer.ts). Measured
the same evening: three real steps on each through the app's own code, on After Dark's key, with OpenRouter's reported
cost per call (8 calls, 2.8¢ in all; each writer needed one second call in its three steps).

| | GLM-4.6 (default) | DeepSeek V3.1 |
|---|---|---|
| Host (reviewed, `adultProviderRouting`) | DeepInfra | CoreWeave (fastest of the two) |
| List price, per million tokens in / out | $0.40–0.50 / $1.60–2.00 | $0.55 / $1.65 |
| Tokens a call, in / out | 2.6–3.3k / ~1.6k (960 of it thinking, billed as output) | 2.6–3k / 430–550 |
| Cost a call | 0.35–0.45¢ | 0.23–0.25¢ |
| Time a call | 90–100 s (the morning's sim: 47 s a step) | 6–8 s |
| A night of 26 steps | ~13–15¢, ~45–60 min of waiting | ~6–10¢, ~4–5 min |
| A subscriber at the month's 300-step cap (`cap_writes`) | ~$1.50 | ~$0.75–1 |
| Blind read (the 2026-10-24 sim, one night each) | **83**, best of six | 66 |

- **Nearly twice the cost and over ten times the wait, for the better writing.** Both are small next to a picture (~1.5¢) or a video ($4–5).
- **Thinking room:** GLM-4.6 thinks ~960 tokens before it writes, inside the step's 1,600-token reply budget, which left about 600 for the lines; one call in four ran out and the step was written again. Each writer now has `think_tokens` added to its reply budget (GLM-4.6: 1,200), so the lines always have room.
- The recaps, memory, facts and clip directions stay on DeepSeek V3.1, so they don't take a minute and a half each.

**Steady-state fixed cost (since 2026-11-22):** about **$70–75 a month** before any model spend:

| | A month |
|---|---|
| DigitalOcean: the show ($25) + After Dark ($10) + the scheduled job (under $1) | ~$36 |
| Neon (November's estimate) | ~$26 |
| Bunny | $1–6 (the $1 minimum until subscribers arrive) |
| Cloudflare Workers Paid (the whole account, shared with the other products) | $5 |
| Cloudflare DNS, Vercel (Hobby), Resend, GitHub | $0 |
| The domain, prorated | ~$2 |
| **Total** | **~$70–75** |

Until 2026-11-21 this page said ~$35–45: the show was $12, and Neon was taken as ~$3–6, which held only in October,
while the database was small and could sleep.
Before the move it was about $25 (Vercel Pro $20 shared with David's other products, Neon ~$5, the domain). Keeping
Vercel Pro would have cost $20 *plus* the After Dark host it needs anyway (~$15–20 with Bunny, `docs/after-dark-hosting.md`),
so ~$45–50; the move is ~$10 a month cheaper and puts After Dark on a host whose terms allow it.

**Neon media transfer:** copying After Dark's media to Bunny on 2026-10-30 read 1.35 GB from the media bucket (Neon
Object Storage), of its 4.5 GB a month.

## Prepaid provider balances

Every model provider is prepaid with auto-recharge off, so the balance is the most a key can spend, except Venice: it has **auto-pay** (David's call, 2026-10-22; confirmed 2026-10-24): whenever the balance drops under $10 it tops itself up, so it never runs dry (it was $12 on 2026-10-24) and its spend is open-ended. Each top-up comes out of the owner budget below.

| Provider | Loaded | Used for | Spent so far (estimate) |
|---|---|---|---|
| Venice | **$125** by the email receipts: $50 on 2026-10-19, a $25 auto top-up on 2026-10-23, $50 on 2026-10-24 (the $75 here before missed the last), **auto-pay: tops up under $10** ($12 on 2026-10-24; **$45.67 on 2026-11-22**) | After Dark pictures, tiles, videos and the Studio; since 2026-10-24 admins' picture checks too | **The first $50 is used up.** From 2026-10-21 23:51 UTC Venice refused every request with 402 "Insufficient USD or Diem balance" until the 2026-10-22 top-up, so no video came through. Production had made 25 video shots, 39 pictures and 131 tiles, about $20–25 at the prices above. Venice's usage page (venice.ai/settings/api) shows where the rest went: the voice A/B clips, or higher video prices than these. |
| Hive | $111 | Moderation and age checks on every picture, tile and clip | ~$1.50 |
| fal.ai | $50 (2026-10-19); $45.05 left on 2026-11-04 | Show tiles, portraits, sets | ~$3. That includes ~$0.70 of tiles thrown away by the Hive-429 bug, fixed in #310. |
| OpenRouter | **$50** (David, 2026-10-21); **$3.99 left on 2026-11-22** | The show's dates (their own key since 2026-10-31, `FRONTIER_LLM_*` in `.do/show.yaml`, with a $50 limit), After Dark scene text, the After Dark eval/A-B runs (`/api/jobs/eval-after-dark`), companion replies, and two keys outside botchelor on the same account (OpenClaw, and LiteLLM/RepoHQ) | **$3.99 is about 160–300 more dates** at 1.3–2.5¢ each; once it's spent, dates fall back to the free model and the other calls on it fail. A top-up, with a limit, is David's call. On 2026-10-22 it was **the whole account: $1.50** (OpenRouter's dashboard, 2026-10-22: 2K requests, 8.84M tokens, $0.17 per million blended). By key: NSFW Botchelor 3.93M tokens (most of the $1.50: the eval runs' $0.90 on pricier models, plus the scenes), OpenClaw 2.59M, LiteLLM + RepoHQ 2.33M. So almost all of the $50 is still there, shared by the three keys. The balance had been empty before the top-up because little was ever loaded, not because something spent it. |
| Google (Gemini) | Pay as you go, billed to the Botchelor project in Google Cloud | The free model the show falls back to, embeddings and evals | Not in the ledger: its bill is in Google Cloud's billing. In October ~$1–2.50 (100 dates, 70 of them on the paid daily quota). |
| Replicate | Credit bought as needed: $74.07 in six purchases, 2026-10-23 to 11-04 | After Dark's second media provider, face kits, voice notes | Purchases after 2026-11-04 aren't in the ledger yet. |
| Runpod | $25 on 2026-11-13; auto-pay adds $25 when the balance drops under $15 | The moving face on calls | ~$9 from 11-13 to 11-15 ($16.01 left then). |

## One-off payments

| Date | What | Amount |
|---|---|---|
| 2026-10-21 | MCP directory listings: [mcp.so](https://mcp.so) and [Glama](https://glama.ai/mcp/connectors/com.botchelor/botcherlor) (com.botchelor) | **$20** (David) |
| 2026-11-13 | Botchelor LLC: Articles of Organization, California Secretary of State (bizfile) | **$70** (David) |
| 2026-11-15 | Stripe's fee on the live test of the 15-date pack ($10 charged and refunded in full; Stripe keeps its fee) | **$0.56** |

Both are on the `/costs` ledger (`money_entries`, added through `/api/admin/spend`).

**Coming for the LLC:** the Statement of Information, **$20**, within 90 days of approval, and California's franchise tax,
**$800 a year**. Neither is paid yet, so neither is on the ledger.

## Spent so far (2026-10-13 to 10-22)

| | Amount |
|---|---|
| Model and media providers (used, estimated) | **~$55–60** (Venice's first $50, all of it; Hive ~$1.50, fal ~$3, OpenRouter ~$1.50) |
| Vercel (team-wide, effective usage including the Pro plan) | ~$17 |
| Neon | $0 until 10-20 (free plan); Launch from then |
| Domain | David's Wix invoice |
| MCP directory listings (one-off) | $20 |
| **Total cash used (excluding the domain)** | **~$90–100** |
| Money loaded into prepaid balances | $236 confirmed (Venice $75 + Hive $111 + OpenRouter $50), plus fal and Venice's $10 auto-recharges |

**Revenue:** $0 from outside buyers. The three paid orders are two Stripe test-mode orders (2026-10-13) and one live
$4 pack bought by David's own account on 2026-10-16 (an end-to-end check).

**Against the $300 owner budget:** about $256 is committed (prepaid balances $236 + the $20 listing), not counting fal or
the shared Vercel and Neon bills, and ~$90–100 has actually been used. That leaves roughly **$44** of the budget for new
commitments before David decides whether to raise it, and each Venice auto-recharge takes $10 of that: about four.

## Volumes behind the estimates (production, 2026-10-21)

- 100 dates (76 in the last 7 days), 58 characters, 2,302 MCP calls.
- 22 approved portraits, 2 clips, 62 sets.
- Looks tiles: 80 show (1 refused) and 50 After Dark.
- After Dark: 12 videos, 3 pictures, 3 reels (2 ready, 1 still making), 132 scene steps.
- Database: 159 MB in total. `adult_images` is 95 MB, `look_tiles` 24 MB and `character_assets` 13 MB.

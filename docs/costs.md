# Botchelor: what it costs

_Written 2026-10-21; updated 2026-10-24 (Venice's auto-pay, the scene writer measured: GLM-4.6 against DeepSeek V3.1,
and admins' picture checks) and 2026-10-30 (the move off Vercel: DigitalOcean, Bunny, Cloudflare; `docs/hosting.md`). It covers what each operation costs, what the infrastructure costs every month, and what
the project has spent so far. All amounts are in US dollars._

The deeper write-ups are `docs/upgrade-cost.md` (a date's token cost, measured) and `docs/after-dark-costs.md`
(After Dark's provider prices and token pricing). This page brings them together with the infrastructure.

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
- DigitalOcean's prices are what its API quoted for each app spec (`POST /v2/apps/propose`); Bunny's are its price list
  and the pull zone's settings.
- Model calls are logged to Vercel's runtime logs (`episode_generated` with `cost_usd`), not to the database. Hobby-era
  logs are gone, so model spend is **estimated**: volume × unit price. The providers' own dashboards hold the exact
  figures.

## Each operation

| Operation | What runs | Cost each |
|---|---|---|
| A date (show model) | ~15 model calls, ~26k tokens in and ~2.2k out | **1.3–2.5¢** (measured; thinking tokens are the spread) |
| A date on an agent's own model (self-performed) | Our hosting only | ~$0 |
| A text in the thread (house reply) | One short model call | well under 0.1¢ |
| A show portrait (looks builder, free to the user) | fal `flux/dev` plus one Hive check | **~1.3¢**. Capped at 3 per character and 150 a day (~$2 a day at most). |
| A looks-builder tile, show tab (drawn once, ever) | fal `flux/dev` plus one Hive check | ~1.5¢ |
| A looks-builder tile, After Dark tab (drawn once, ever) | Venice `lustify` plus Hive moderation and age check | ~1.4¢ |
| A set (an empty place, drawn once per place) | fal `flux/schnell` plus Hive | ~0.5¢ |
| One After Dark scene step (6 lines), the default writer since 2026-10-24 | OpenRouter **GLM-4.6** `z-ai/glm-4.6` on DeepInfra (the only reviewed host that serves it): ~2.6–3.3k tokens in, ~1.6k out, 960 of them thinking | **~0.35–0.45¢ a call, ~0.5¢ a step** (now and then a step takes a second call), and **90–100 s a call** (measured 2026-10-24, below). Each person can switch to DeepSeek V3.1 (lib/adult/writer.ts). |
| One After Dark scene step on DeepSeek V3.1, and every recap, memory, fact and clip direction | OpenRouter **DeepSeek V3.1** `deepseek/deepseek-chat-v3.1:nitro` (throughput-sorted, CoreWeave) since 2026-10-22; Dolphin-Mistral 24B before | **~0.23–0.25¢ a call** and 6–8 s (measured 2026-10-24; ~0.18–0.21¢ when first measured, Dolphin ~0.15¢, DeepSeek on DeepInfra ~0.09¢). Without `:nitro`, default routing picked DeepInfra: 40–55 s a step, 429s and about 1 empty step in 26. DeepSeek won the blind reads against Dolphin (8.2 and 8.5 of 10, #612, against 3.5 and 4.0). |
| An After Dark eval run (4 steps, `/api/jobs/eval-after-dark`) | OpenRouter: Dolphin v1 0.3¢, Dolphin v2 with facts 0.7¢, DeepSeek V3.1 1.4¢, Hermes 3 70B 1.6¢, Euryale 70B 2¢, Hermes 4 405B 3.5¢ | capped at $0.25 a run and $2 a day (botchelor-2c) |
| One After Dark picture | Venice plus Hive moderation and age check | ~1.5¢ |
| An admin's own picture check (since 2026-10-24) | The Venice vision model's age question (`qwen3-vl-235b-a22b`) instead of Hive (`moderation.admin_checker`) | ~0.03¢, with no daily cap. Videos still go to Hive. |
| The video of the night (6 shots, Wan 3.0, ~30 s) | Venice video, a $0.04 keyframe of the two of them per shot, plus Hive on every keyframe and shot | **$4.25–5.50** (sells for 15 tokens, ~$10.80 after Stripe) |
| A 15 s clip, standard (LongCat) | Venice video plus Hive | $0.30–0.80 |
| Email (Resend) | Free plan, 3,000 a month | $0 |
| A sale | Stripe 2.9% + 30¢ | **42¢** on a $4 pack |
| Simulation run (`npm run sim:relationships`, paid mode) | 10 couples × 5 dates on Haiku | ~65¢ a run (stub mode is $0) |
| Agent visitor loops (`scripts/loop/*`) | David's Claude subscription, stub models in the arena | $0 cash |
| Nightly database backup (ai-stack `bin/db-backup`) | `pg_dump` of ~180 MB | $0 on Launch (it was ~1 GB a week of the free plan's 5 GB transfer) |

**Database transfer (the cost behind the 2026-10-20 outage):** After Dark media was served straight from Postgres with
no caching. A 10 MB video re-downloaded on every view used 10 MB of Neon transfer each time. #499 lets the admin's
browser keep finished files. Moving the bytes to object storage is in progress (see "In progress" in
`docs/history/2026-10-19-to-21.md`).

## Infrastructure, per month

| Service | Plan | Monthly cost | Notes |
|---|---|---|---|
| Vercel | **Hobby** (free) since 2026-10-30; Pro before | **$0** for botchelor | David moved the team to Hobby on 2026-10-30. Hobby can't build botchelor (12 functions a deployment, daily cron only, no commercial use), so the show moved to DigitalOcean (`docs/hosting.md`). The last Vercel build keeps serving botchelor.com until the Cloudflare cutover. October on Pro, mostly build minutes: ~$17 of the $20 credit by 10-21 and ~$2 billed above it. |
| DigitalOcean App Platform: the show | `botchelor-show`, 1 vCPU / 1 GiB (`apps-s-1vcpu-1gb`), since 2026-10-30 | **$12** | `.do/show.yaml`. 100 GiB of outbound traffic included, then $0.02 a GiB. No hard cap: the instance price is fixed. |
| DigitalOcean App Platform: After Dark | `clownfish-app` (ad.botchelor.com), 1 vCPU / 1 GiB fixed (`apps-s-1vcpu-1gb-fixed`), since 2026-10-30 | **$10** | `.do/app.yaml`. 100 GiB out included. |
| DigitalOcean scheduled job | On After Dark's app: the lobby hourly, the showcase check hourly, the daily job at 16:20 UTC | **up to $5** | Smallest size (`apps-s-1vcpu-0.5gb`), billed for the time it runs. Each hourly run lasts ~20 minutes (it waits between the lobby and the showcase check), so expect well under $5. DigitalOcean quoted $15 for After Dark's app with the job. A $15 spend alert is still to be set (Billing → Spend alerts; the form didn't save from automation). |
| Bunny (After Dark's media, media.botchelor.com) | Storage zone `botchelor-ad` (New York, Standard) + pull zone `botchelor-ad-media` | **$1 minimum, ~$1–6** | Storage $0.025/GB a month (1.35 GB copied on 2026-10-30: ~3¢). CDN $0.01/GB in Europe and North America; Asia, Africa and South America are switched off. **Spend cap: 500 GB a month on the pull zone (at most $5 of traffic).** Prepaid: on a 14-day trial ($20 of trial credit, ends ~2026-11-13). Before then David adds $20 with Auto-Recharge off, or the account is disabled. |
| Cloudflare (DNS and proxy for botchelor.com) | **Free** | $0 | Being set up 2026-10-30: DNS for botchelor.com, the bare domain proxied to the show, visitor location headers (After Dark's region rules). DigitalOcean's DNS holds the zone until the nameservers move. |
| Neon (Postgres) | **Launch** since 2026-10-20 (account 1426davejobs.agent@gmail.com) | **~$3–6** expected for botchelor | Compute $0.106 per CU-hour (32 CU-hours used in October so far), storage $0.35 per GB-month (~0.18 GB), transfer free up to 500 GB. A spending notification is set at $20. The same Neon org also holds alterpaw, squadwrap, tiebreak, grantgate and test, which are billed together. |
| Domain botchelor.com | Wix registrar | David to fill in (typically ~$15–25 a year) | Wix is the registrar only. Since 2026-10-30 DNS is at DigitalOcean, moving to Cloudflare (`docs/hosting.md`). |
| Stripe | Pay per sale | $0 fixed | 2.9% + 30¢ per purchase. |
| Resend (email) | Free | $0 | 3,000 emails a month, 100 a day. |
| Google Analytics 4, Search Console, Bing Webmaster | Free | $0 | |
| Vercel Web Analytics | Off since the move (it only runs on Vercel) | $0 | Google Analytics carries on. |
| GitHub | Free | $0 | Actions minutes ran out on 2026-10-19 (reset around Nov 1). Since #575 (10-21) botchelor's CI runs by hand only, so the free minutes go to RepoHQ; merges are gated on local typecheck + tests ([BUILD.md](../BUILD.md)). |
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

**Steady-state fixed cost (since 2026-10-30):** about **$30–40 a month** before any model spend:

| | A month |
|---|---|
| DigitalOcean: the show ($12) + After Dark ($10) + the scheduled job (up to $5) | $22–27 |
| Neon | ~$3–6 |
| Bunny | $1–6 (the $1 minimum until subscribers arrive) |
| Cloudflare, Vercel (Hobby), Resend, GitHub | $0 |
| The domain, prorated | ~$2 |
| **Total** | **~$28–41** |

Before the move it was about $25 (Vercel Pro $20 shared with David's other products, Neon ~$5, the domain). Keeping
Vercel Pro would have cost $20 *plus* the After Dark host it needs anyway (~$15–20 with Bunny, `docs/after-dark-hosting.md`),
so ~$45–50; the move is ~$10 a month cheaper and puts After Dark on a host whose terms allow it.

**Neon media transfer:** copying After Dark's media to Bunny on 2026-10-30 read 1.35 GB from the media bucket (Neon
Object Storage), of its 4.5 GB a month.

## Prepaid provider balances

Every model provider is prepaid with auto-recharge off, so the balance is the most a key can spend, except Venice: it has **auto-pay** (David's call, 2026-10-22; confirmed 2026-10-24): whenever the balance drops under $10 it tops itself up, so it never runs dry (it was $12 on 2026-10-24) and its spend is open-ended. Each top-up comes out of the owner budget below.

| Provider | Loaded | Used for | Spent so far (estimate) |
|---|---|---|---|
| Venice | **$125** by the email receipts: $50 on 2026-10-19, a $25 auto top-up on 2026-10-23, $50 on 2026-10-24 (the $75 here before missed the last), **auto-pay: tops up under $10** ($12 on 2026-10-24) | After Dark pictures, tiles, videos and the Studio; since 2026-10-24 admins' picture checks too | **The first $50 is used up.** From 2026-10-21 23:51 UTC Venice refused every request with 402 "Insufficient USD or Diem balance" until the 2026-10-22 top-up, so no video came through. Production had made 25 video shots, 39 pictures and 131 tiles, about $20–25 at the prices above. Venice's usage page (venice.ai/settings/api) shows where the rest went: the voice A/B clips, or higher video prices than these. |
| Hive | $111 | Moderation and age checks on every picture, tile and clip | ~$1.50 |
| fal.ai | Prepaid (see the fal dashboard) | Show tiles, portraits, sets | ~$3. That includes ~$0.70 of tiles thrown away by the Hive-429 bug, fixed in #310. |
| OpenRouter | **$50** (David, 2026-10-21) | After Dark scene text, the After Dark eval/A-B runs (`/api/jobs/eval-after-dark`), and two keys outside botchelor on the same account (OpenClaw, and LiteLLM/RepoHQ) | **The whole account: $1.50** (OpenRouter's dashboard, 2026-10-22: 2K requests, 8.84M tokens, $0.17 per million blended). By key: NSFW Botchelor 3.93M tokens (most of the $1.50: the eval runs' $0.90 on pricier models, plus the scenes), OpenClaw 2.59M, LiteLLM + RepoHQ 2.33M. So almost all of the $50 is still there, shared by the three keys. The balance had been empty before the top-up because little was ever loaded, not because something spent it. |
| Model key for dates (Gemini, or the frontier key when set) | Pay as you go | The show's dates and texts | ~$1–2.50 (100 dates, 70 of them on the paid daily quota) |

## One-off payments

| Date | What | Amount |
|---|---|---|
| 2026-10-21 | MCP directory listings: [mcp.so](https://mcp.so) and [Glama](https://glama.ai/mcp/connectors/com.botchelor/botcherlor) (com.botchelor) | **$20** (David) |

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

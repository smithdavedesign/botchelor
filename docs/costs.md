# Botchelor: what it costs

_Written 2026-10-21. It covers what each operation costs, what the infrastructure costs every month, and what the
project has spent so far. All amounts are in US dollars._

The deeper write-ups are `docs/upgrade-cost.md` (a date's token cost, measured) and `docs/after-dark-costs.md`
(After Dark's provider prices and token pricing). This page brings them together with the infrastructure.

**How the numbers were found:**
- Unit prices come from those two docs and the providers' pricing pages.
- Volumes come from read-only counts on the production database (2026-10-21).
- Vercel's figures come from its billing API.
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
| One After Dark scene step (6 lines) | OpenRouter **DeepSeek V3.1** `deepseek/deepseek-chat-v3.1:nitro` (throughput-sorted routing, picks CoreWeave) since 2026-10-22; Dolphin-Mistral 24B before | **~0.18–0.21¢** (Dolphin was ~0.15¢; DeepSeek on the cheapest host, DeepInfra, ~0.09¢). About 5.5–7.6 s a step on CoreWeave. Without `:nitro`, default routing picked DeepInfra: 40–55 s a step, 429s and about 1 empty step in 26. DeepSeek won the blind reads (8.2 and 8.5 of 10 on the explicit-stage run, #612, against Dolphin's 3.5 and 4.0). |
| An After Dark eval run (4 steps, `/api/jobs/eval-after-dark`) | OpenRouter: Dolphin v1 0.3¢, Dolphin v2 with facts 0.7¢, DeepSeek V3.1 1.4¢, Hermes 3 70B 1.6¢, Euryale 70B 2¢, Hermes 4 405B 3.5¢ | capped at $0.25 a run and $2 a day (botchelor-2c) |
| One After Dark picture | Venice plus Hive moderation and age check | ~1.5¢ |
| The video of the night (6 shots, Wan 3.0, ~30 s) | Venice video plus Hive on every shot | **$4.00–5.20** (sells for 15 tokens, ~$10.80 after Stripe) |
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
| Vercel | **Pro** (team "David Smith's projects") | **$20**, plus usage beyond the included $20 credit | Shared by every project on the team, not botchelor alone. October usage, mostly build minutes: ~$17 of the $20 credit by 10-21 and ~$2 billed above it. Speed Insights Plus and Observability Plus are off. |
| Neon (Postgres) | **Launch** since 2026-10-20 (account 1426davejobs.agent@gmail.com) | **~$3–6** expected for botchelor | Compute $0.106 per CU-hour (32 CU-hours used in October so far), storage $0.35 per GB-month (~0.18 GB), transfer free up to 500 GB. A spending notification is set at $20. The same Neon org also holds alterpaw, squadwrap, tiebreak, grantgate and test, which are billed together. |
| Domain botchelor.com | Wix registrar | David to fill in (typically ~$15–25 a year) | DNS records live at Wix (`docs/launch-readiness.md`). |
| Stripe | Pay per sale | $0 fixed | 2.9% + 30¢ per purchase. |
| Resend (email) | Free | $0 | 3,000 emails a month, 100 a day. |
| Google Analytics 4, Search Console, Bing Webmaster | Free | $0 | |
| Vercel Web Analytics | Included in Pro | $0 | |
| GitHub | Free | $0 | Actions minutes ran out on 2026-10-19 (reset around Nov 1). Since #575 (10-21) botchelor's CI runs by hand only, so the free minutes go to RepoHQ; merges are gated on local typecheck + tests ([BUILD.md](../BUILD.md)). |
| Claude (all agent work) | David's subscription | Not per project | Never API credit. |

**Steady-state fixed cost:** about **$25 a month** (Vercel Pro $20, Neon ~$5, the domain prorated) before any model
spend. Vercel is shared with David's other products.

## Prepaid provider balances

Every model provider is prepaid with auto-recharge off, so the balance is the most a key can spend.

| Provider | Loaded | Used for | Spent so far (estimate) |
|---|---|---|---|
| Venice | $50 | After Dark pictures, tiles and videos | **Used up.** Venice has refused every request with 402 "Insufficient USD or Diem balance" since 2026-10-21 23:51 UTC, so no video has come through since. Production made 25 video shots, 39 pictures and 131 tiles, about $20–25 at the prices above. Venice's usage page (venice.ai/settings/api) shows where the rest of the $50 went: the voice A/B clips, or higher video prices than these. A top-up is David's call. |
| Hive | $111 | Moderation and age checks on every picture, tile and clip | ~$1.50 |
| fal.ai | Prepaid (see the fal dashboard) | Show tiles, portraits, sets | ~$3. That includes ~$0.70 of tiles thrown away by the Hive-429 bug, fixed in #310. |
| OpenRouter | **$50** (David, 2026-10-21) | After Dark scene text, the After Dark eval/A-B runs (`/api/jobs/eval-after-dark`), and two keys outside botchelor on the same account (OpenClaw, and LiteLLM/RepoHQ) | **The whole account: $1.50** (OpenRouter's dashboard, 2026-10-22: 2K requests, 8.84M tokens, $0.17 per million blended). By key: NSFW Botchelor 3.93M tokens (most of the $1.50: the eval runs' $0.90 on pricier models, plus the scenes), OpenClaw 2.59M, LiteLLM + RepoHQ 2.33M. So almost all of the $50 is still there, shared by the three keys. The balance had been empty before the top-up because little was ever loaded, not because something spent it. |
| Model key for dates (Gemini, or the frontier key when set) | Pay as you go | The show's dates and texts | ~$1–2.50 (100 dates, 70 of them on the paid daily quota) |

## One-off payments

| Date | What | Amount |
|---|---|---|
| 2026-10-21 | MCP directory listings: [mcp.so](https://mcp.so) and [Glama](https://glama.ai/mcp/connectors/com.botchelor/botcherlor) (com.botchelor) | **$20** (David) |

## Spent so far (2026-10-13 to 10-21)

| | Amount |
|---|---|
| Model and media providers (used, estimated) | **~$20–30** |
| Vercel (team-wide, effective usage including the Pro plan) | ~$17 |
| Neon | $0 until 10-20 (free plan); Launch from then |
| Domain | David's Wix invoice |
| MCP directory listings (one-off) | $20 |
| **Total cash used (excluding the domain)** | **~$60–70** |
| Money loaded into prepaid balances | $211 confirmed (Venice $50 + Hive $111 + OpenRouter $50), plus fal |

**Revenue:** $0 from outside buyers. The three paid orders are two Stripe test-mode orders (2026-10-13) and one live
$4 pack bought by David's own account on 2026-10-16 (an end-to-end check).

**Against the $300 owner budget:** about $231 is committed (prepaid balances $211 + the $20 listing), not counting fal or
the shared Vercel and Neon bills, and ~$60–70 has actually been used. That leaves roughly **$70** of the budget for new
commitments before David decides whether to raise it.

## Volumes behind the estimates (production, 2026-10-21)

- 100 dates (76 in the last 7 days), 58 characters, 2,302 MCP calls.
- 22 approved portraits, 2 clips, 62 sets.
- Looks tiles: 80 show (1 refused) and 50 After Dark.
- After Dark: 12 videos, 3 pictures, 3 reels (2 ready, 1 still making), 132 scene steps.
- Database: 159 MB in total. `adult_images` is 95 MB, `look_tiles` 24 MB and `character_assets` 13 MB.

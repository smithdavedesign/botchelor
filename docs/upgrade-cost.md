# Upgrade cost: what a date costs, and what each upgrade would

_Written for David, 2026-10-13; updated 2026-10-15 with measured numbers. A spend proposal, not a switch that
has been flipped._

Everything in the repo today runs at **$0 marginal cost** on free models and the free stack (Vercel Hobby,
Neon free, Gemini free tier). The PRD's Product-vision and Target-architecture sections describe a richer
product — frontier dialogue, portraits, video — that **costs money and needs your approval first** (agents
spend nothing; you put in up to the $300-per-product budget and pay). This doc says what a date really costs,
what each upgrade buys and costs, and a staged order that stays inside $300.

**Model prices were read from Google's pricing page on 2026-10-15. Other providers' figures are representative
ranges: confirm the live numbers before authorising any spend.**

## What a date costs (measured)

**How it was measured.** Every prompt of six real eval dates (`docs/eval/v3-lite.json`) was rebuilt offline with
the app's own code, with no model calls. Each was priced at Google's paid list price for the live model,
`gemini-3.5-flash-lite`: **$0.30 per 1M tokens in, $2.50 per 1M out**, with thinking billed as output. From now on,
every generated date logs its real token counts and that price on the `episode_generated` event (see below), so
this table becomes a measurement, not an estimate.

| Part of a date | Calls | Tokens in / out | Cost at paid prices |
|---|---|---|---|
| The plan (director) | 1 | ~2,100 / ~700 | 0.24¢ |
| The conversation (each turn resends the date so far) | 10 | ~16,400 / ~600 | 0.64¢ |
| The critic's rewrites | ~3 | ~5,200 / ~200 | 0.20¢ |
| The recap (director) | 1 | ~2,100 / ~700 | 0.24¢ |
| **A whole date** | **~15** | **~26k / ~2.2k** | **~1.3¢** |
| The afterglow (only when the owners open it) | 4 | ~5,500 / ~100 | +0.2¢ |

- **Thinking is the open question.** Gemini 3 models can't turn thinking off. Its tokens bill as output and
  weren't in the measurement: at ~300 a call, a date is ~2.4¢. **Budget 1–2.5¢ a date** until the logs say
  otherwise.
- **A better director**: `gemini-3.8-flash` for the plan and the recap adds ~0.4–1.1¢ a date now, and ~2.7¢
  from 2027-01-01, when Google doubles its price.
- **A frontier model for every role**: a date is ~26k tokens in and ~2.2k out, so cost ≈ 26 × (input $/M) +
  2.2 × (output $/M), in thousandths of a dollar. At $1–3 in and $5–15 out per 1M (mid frontier), that's
  ~4–11¢ a date. At $5 in and $25 out (top frontier), ~19¢. The 2026-10-13 version of this doc assumed one
  call per date, which understates today's pipeline about tenfold.

**What keeps it down (in place since #55):**
- **Thinking level per role.** Both the actor (every line, the texts) and the director (plan, recap) ask for
  `low` (the actor was raised from `minimal` on 2026-10-15 so it follows the grounded-first-date rules; budget a
  little more thinking on the ~12 conversation calls). Override with `LLM_ACTOR_REASONING` /
  `LLM_DIRECTOR_REASONING` (`default` sends none). A model that refuses the setting is asked again without it,
  and remembered.
- **Compact prompts.** The prompts are compact JSON: indentation was 5–8% of every call.
- **Cache-friendly order.** The stable part of each turn (the rules, the speaker's own sheet, what they can see)
  comes first, so Gemini's implicit caching can discount it. Cached tokens are logged.
- **The conversation history is kept on purpose.** It's ~15% of a turn's prompt, and callbacks to earlier lines
  are one of the quality goals (`docs/date-quality.md`).

## What saving a date costs

- **A date is ~6 KB**: the transcript is ~2.3 KB; the rest is scenes, confessionals, the box score and the setup.
  **A character is ~3 KB**, with its soul and learned memory.
- Neon's free plan holds 1 GB per project, which is ~165,000 dates. Past that it's $0.35/GB-month, about
  **$0.002 a month per thousand dates**. Storage doesn't belong in the price.

## Fixed costs (what actually matters)

| Item | Cost | Why |
|---|---|---|
| Hosting | **$20/month** (Vercel Pro, $20 usage included) or $0 (Netlify free) | Vercel Hobby is "personal, non-commercial": Stripe stays in test mode until the host changes |
| Gemini paid key | ~1–2.5¢ a date | The free tier stops after a few hundred calls a day (~25–30 dates; it ran out on 2026-10-15). Paid prompts also aren't used to improve Google's products, which matters because they carry visitors' private souls |
| Database | $0 on the free plan; worst case ~$20/month | Live watch rooms poll every 4s and keep the compute awake; always-on at 0.25 CU is ~182 CU-hours × $0.106 |
| Stripe | 2.9% + 30¢ a purchase | The flat 30¢ is what punishes small prices |

## What it means for pricing

| Offer | Stripe fee | You keep | Model cost | Margin |
|---|---|---|---|---|
| 5 dates for $4 (live price) | $0.42 | $3.58 | 7–15¢ | ~96% |
| 15 dates for $9 | $0.56 | $8.44 | 20–45¢ | ~95% |
| $4.99 a month for 30 dates | $0.44 | $4.55 | 40–90¢ | 80–90% |

- **Free dates are the real cost.** 3 a week is ~13 a month per active creator: 17–39¢ per creator per month on
  paid Gemini. One $4 pack pays for the free dates of ~10–20 creators who never buy.
- **Break-even** on $20–40 a month of fixed costs is ~6–11 packs a month.
- **Avoid prices under ~$3**: Stripe's 30¢ alone is 10% or more.
- **A premium tier is cheap to run**: a better director plus the afterglow is ~1–3¢ more per date.

### Where the real numbers show up
Every generated date logs `episode_generated` (`lib/analytics.ts`) with `where` (job, template,
template_retake, backfill), `model_calls`, `input_tokens`, `cached_input_tokens`, `output_tokens`,
`thinking_tokens` and `cost_usd` (paid-tier list price, `lib/pricing.ts`). The eval reports the same per date
(`eval-report`: "Tokens in / out", "Paid-tier cost / date"). After the first day of real dates, replace the
estimates above with those numbers.

## Bring your own key (considered, not built)

Letting a player use their own provider key would take that player's dates off our bill and our daily cap, and
let them choose a stronger model. The engine still decides every outcome, so a better model can't buy a win.
What it needs, from the design review on 2026-10-15:
- **Privacy: a key may only carry its owner's side.** Each actor's prompt holds only that side's private soul
  (plus a blind view of the other). So A's key may play A's turns, and a house character's (house characters
  have no private text), but **never** B's turns. The director and the narrator see both souls, so they stay on
  the platform key. A player's key would then cover the ~12 conversation calls (about two-thirds of a date)
  and their afterglow texts.
- **Known providers only** (Google, OpenAI, Anthropic, OpenRouter, …), with **no custom endpoints**. Otherwise a
  player could point the calls at their own server, read everything in them, and use our server to call
  arbitrary URLs.
- **Where the key lives.** Kept only in the player's browser and sent with the requests that need it (starting a
  date, opening the afterglow), it's never stored, logged or written to the job table, and no sign-in is needed.
  Stored server-side (encrypted, e.g. Vercel KMS), it survives retries and works across devices, but then it
  needs an account to protect it: an anonymous one (a passkey, no email, no name) keeps the show's anonymity.
- **What it changes about money:** dates on a player's own key cost us only hosting and storage (fractions of a
  cent). Revenue then comes from what isn't a model call: cosmetics, formats, character slots, a season pass.
## What is already built (so the upgrade is just swapping a provider)

The hard work that makes paid models optional is done:

- **The outcome is decided by the engine, not the model** (`lib/engine.ts`). A better model makes the writing
  funnier and more in-character; it does **not** change who the date pairs, who gets rejected, the box score,
  the predictions or the points. So you can turn a frontier model on or off per environment with no gameplay risk.
- **The model is already an OpenAI-compatible client** (`lib/model.ts`) read from env (`LLM_BASE_URL`,
  `LLM_API_KEY`, `LLM_MODEL`). Upgrading text quality is a config change, not a code change.
- **The model work per date is bounded**: ~15 calls (a plan, ten turns, a few critic rewrites, the recap), all
  best-effort except the recap, with a fail-fast on a spent quota (`lib/model.ts`).

## 1. Frontier text model (the cheapest, highest-leverage upgrade)

**What it buys:** noticeably better dialogue, wit and character voice — the thing that decides whether the loop
is fun (PRD: "If that loop is fun with text and portraits, the product is worth investing in").

**Cost model:** a date is ~26k tokens in and ~2.2k out over ~15 calls (measured, above):

| Tier | ~$/date | 2,000 dates/mo | Notes |
|---|---|---|---|
| Free (today) | $0 | $0 | Gemini free tier; a daily cap of ~25–30 dates; prompts may be used by Google |
| Paid `gemini-3.5-flash-lite` (the live model) | ~$0.01–0.025 | ~$25–50/mo | same quality, no daily cap, no training on prompts |
| …plus a `gemini-3.8-flash` director | ~$0.02–0.035 (2027: ~$0.04–0.05) | ~$40–70/mo | the A/B proposed in `docs/date-quality.md` |
| Mid frontier for every role | ~$0.04–0.11 | ~$80–220/mo | |
| Top frontier for every role | ~$0.19 | ~$380/mo | over budget at volume; only for gated runs |

**How to turn it on safely:**
- Route through **Vercel AI Gateway** (one key, model fallbacks, spend caps, zero-data-retention option) and set
  `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` to it. Keep the free model as the fallback so an episode still fails
  closed to $0 rather than failing the user.
- **Build the compute-budget gate first.** The PRD separates the fictional *date budget* (free, in-game) from the
  real *compute budget* (dollars). Before any paid call, add a hard per-user and per-day cap in dollars that the
  backend enforces (reserve the estimated cost, refuse or downgrade to the free model when the cap is hit). This
  is ~a day's work and is the thing that makes a paid key safe to expose. It does not exist yet.

**Recommendation:** Stage 1 is the live model on a **paid key with a hard cap** (say $10–30/mo), plus the
compute-budget gate. It costs the same quality-wise, but it removes the daily cap and the training-on-prompts
issue. Then the `gemini-3.8-flash` director A/B. A mid-frontier model for every role only if the A/B shows the
writing still holds the show back.

**2026-10-15 — the paid actor, specifically (David asked to "offer paid actor model").** The free-tier round
(actor reasoning → `low`, grounded prompt, `motif_fixation` critic, visible wants; see `docs/date-quality.md`
Round 2) is the ceiling without spending — the director stays on the free flash-lite there, because the
stronger flash models 429 on the free key. The next lever is putting the ~12 **actor**
turns on a paid model. This is already gated and needs no code change — it rides the frontier key
(`docs/frontier.md`): set `FRONTIER_LLM_BASE_URL/_API_KEY/_MODEL` (via **Vercel AI Gateway**, with the free model
kept as fallback), and the public flow stays $0 until a request carries the owner's `x-frontier-key`.

What to buy, and the ask for approval:
- **Model:** start with the live model on a **paid** Gemini key (`gemini-3.5-flash-lite`, same quality, no daily
  cap, prompts not used for training) for the actor, and set `LLM_DIRECTOR_MODEL=gemini-3.5-flash` (now that the
  key is paid, it stops 429-ing) for the stronger plan/recap. If the eval A/B wants more wit, step the actor up
  to a mid-frontier model (a Claude Haiku / GPT-mini class via the Gateway).
- **Cost at today's pipeline:** ~1–2.5¢/date on paid Gemini; ~4–11¢/date if the actor goes mid-frontier (table
  above). At 2,000 dates/mo that's ~$25–50 (paid Gemini) to ~$80–220 (mid-frontier every role).
- **Provider cap to set at creation (policy: cap every billable key):** a **hard monthly budget on the Vercel AI
  Gateway key**, suggested **$30/mo** to start, stored with `~/ai-stack/bin/secrets add … --cap "$30/mo"` and
  read from env. The in-app compute-budget gate (per-user/per-day dollar cap) is the second guard and still
  needs building (~a day) before exposing a paid key in the public flow.
- **Approval needed from David:** (1) which model for the actor, (2) the monthly cap value, (3) go-ahead to
  create the capped Gateway key and build the compute-budget gate. Agents don't create billable keys or spend;
  this is the proposal — David approves and pays.

## 2. Character portraits (Level 1 images)

**What it buys:** a consistent portrait per character and simple scene art — the visual payoff that still plays
instantly, without video (PRD video strategy, Level 1).

**Two ways:**
- **Hosted diffusion** (fal, Replicate, or similar): ~$0.01–0.05 per image, no infra to run. A portrait is
  generated **once per character and cached**, so cost scales with new characters, not with dates. 1,000 new
  characters ≈ $10–50 one-off.
- **Self-hosted ComfyUI + an open diffusion model** on a rented GPU: ~$0.5–1.5/GPU-hour. Only cheaper than hosted
  at high, steady volume; adds ops burden. Not recommended until volume justifies it.

**New infra this needs:**
- **Object storage + CDN** for the images: **Vercel Blob** (public or private, OIDC) or S3 + CloudFront.
  ~$5–20/mo at low volume; mostly egress.
- No queue strictly required for stills if you generate on character creation and cache.

## 3. Short video clips (Level 2) — the expensive, demand-gated one

**What it buys:** 3–8s clips at pivotal moments (first impression, a rejection). The PRD's **crowd-unlocked clips**
mechanic already exists as a concept: render only after enough viewers ask, so GPU spend follows demand.

**Cost:** **Wan 2.2 (Apache-2.0) through ComfyUI** on a rented GPU (A10/L4/A100 class). A 3–8s clip is a few GPU-
minutes; at ~$0.5–2.0/GPU-hour that is ~$0.05–0.30 per clip, plus storage/egress. Variable and spiky.

**New infra this needs (the "full stack" the Target architecture describes):**
- **A job queue + workers** — generation exceeds an HTTP request. **Vercel Queues** (beta) or Redis + BullMQ via
  **Upstash** (free tier, then ~$10/mo). Submit a job, return an id, render in a worker, notify the client.
- **GPU capacity** — a serverless GPU host (fal/Replicate/Modal) billed per second, or a rented box. Serverless is
  the right first step: no idle cost.
- The same Blob/CDN storage from §2, with retention policies.

**Recommendation:** last. Only after the text-and-portrait loop is shown to retain users.

## 4. Hosting and payments

- **Taking real money needs a commercial-use host.** Vercel Hobby does not allow it (BUILD.md). The $0 option is
  **Netlify's free plan**; the paid option is **Vercel Pro (~$20/mo)**. This is independent of the model upgrades
  and is already flagged in `.provision`.
- The paid-model and media work is host-agnostic; only `lib/db.ts` special-cases Vercel.

## 5. The private soul and which models may see it

Open question from the PRD, with a recommendation. A soul can be built from the owner themselves, so it is
personal data.

- **Default (recommended):** a soul is sent only to a **zero-data-retention** endpoint (AI Gateway ZDR, or a
  provider contractually not training on inputs) — never to a free tier that may train on prompts. Owners can
  already delete a soul (`DELETE /api/characters/[id]/soul`).
- **Local-only soul (built).** Owners can mark a soul **local-only**: it drives the deterministic engine (via
  `deriveSoulSignals`) but its text is **never sent to any model**, even a paid one. This shipped as part of the
  simulation build, so a privacy-sensitive owner can already play without their soul leaving the database. When a
  paid model is switched on, local-only souls are unaffected.

## Staged plan against the $300 budget

| Stage | Buys | ~Monthly | Caps |
|---|---|---|---|
| 0 (now) | Free models, free stack | $0 | — |
| 1 | Compute-budget gate + the live model on a paid key (then the director A/B) | ~$10–50 | hard $/day cap; free-model fallback |
| 2 | Level 1 portraits (hosted, cached) + Blob/CDN | ~$20–50 | cost per new character, not per date |
| 3 | Commercial-use host for live payments | $0 (Netlify) or ~$20 (Vercel Pro) | — |
| 4 | Level 2 crowd-unlocked video + queue/GPU | usage-based, spiky | demand-gated; per-user clip cap |

Stages 1–3 together are roughly **$40–90/month**, i.e. several months inside the $300 budget, and each has a hard
cap. Stage 4 is the only open-ended one and stays off until the text loop proves out.

**To proceed:** pick a stage, I'll write the exact spend request (provider, env vars from the keychain, the hard
caps, and the compute-budget gate), and you approve and pay. Nothing here is switched on until then.

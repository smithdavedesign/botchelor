# Upgrade cost: frontier models and the full stack

_Written for David, 2026-10-13. This is a spend proposal, not a switch that has been flipped._

Everything in the repo today runs at **$0 marginal cost** on free models and the free stack (Vercel Hobby,
Neon free, Gemini free tier via LiteLLM/OpenAI-compatible). The PRD's Product-vision and Target-architecture
sections describe a richer product — frontier dialogue, portraits, video — that **costs money and needs your
approval first** (agents spend nothing; you put in up to the $300-per-product budget and pay). This doc says
what each upgrade buys, roughly what it costs, and a staged order that stays inside $300.

**All prices below are representative, order-of-magnitude figures. Confirm the live numbers on the provider
dashboards (or via Vercel AI Gateway spend reports) before authorising any spend.**

## What is already built (so the upgrade is just swapping a provider)

The hard work that makes paid models optional is done:

- **The outcome is decided by the engine, not the model** (`lib/engine.ts`). A better model makes the writing
  funnier and more in-character; it does **not** change who the date pairs, who gets rejected, the box score,
  the predictions or the points. So you can turn a frontier model on or off per environment with no gameplay risk.
- **The model is already an OpenAI-compatible client** (`lib/model.ts`) read from env (`LLM_BASE_URL`,
  `LLM_API_KEY`, `LLM_MODEL`). Upgrading text quality is a config change, not a code change.
- **One model call per episode.** Narration only. No chat loop, no retries beyond one.

## 1. Frontier text model (the cheapest, highest-leverage upgrade)

**What it buys:** noticeably better dialogue, wit and character voice — the thing that decides whether the loop
is fun (PRD: "If that loop is fun with text and portraits, the product is worth investing in").

**Cost model:** one episode is ≈ 2,000 input tokens (two sheets + private souls + the decided-outcome brief) and
≈ 700 output tokens (scenes, best line, two confessionals). Per episode that is a fraction of a cent to ~2 cents
depending on the model tier:

| Tier | ~$/episode | 2,000 episodes/mo | Notes |
|---|---|---|---|
| Free (today) | $0 | $0 | Gemini free tier; quality ceiling, rate limits |
| Mid frontier (e.g. a Sonnet- or GPT-mid-class model) | ~$0.005–0.015 | ~$10–30/mo | the recommended first paid step |
| Top frontier (e.g. an Opus- or GPT-top-class model) | ~$0.03–0.08 | ~$60–160/mo | best writing; likely overkill for a date |

**How to turn it on safely:**
- Route through **Vercel AI Gateway** (one key, model fallbacks, spend caps, zero-data-retention option) and set
  `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` to it. Keep the free model as the fallback so an episode still fails
  closed to $0 rather than failing the user.
- **Build the compute-budget gate first.** The PRD separates the fictional *date budget* (free, in-game) from the
  real *compute budget* (dollars). Before any paid call, add a hard per-user and per-day cap in dollars that the
  backend enforces (reserve the estimated cost, refuse or downgrade to the free model when the cap is hit). This
  is ~a day's work and is the thing that makes a paid key safe to expose. It does not exist yet.

**Recommendation:** Stage 1 is a mid-frontier model through AI Gateway with a hard cap (say $30/mo), plus the
compute-budget gate. Biggest quality jump for the least money and risk.

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
- **Offer a "local-only soul":** a soul that influences the deterministic engine (via `deriveSoulSignals`) but is
  **never sent to any model**. The engine already works from signals, so this is a small flag. It lets privacy-
  sensitive owners play without their soul leaving the database.

## Staged plan against the $300 budget

| Stage | Buys | ~Monthly | Caps |
|---|---|---|---|
| 0 (now) | Free models, free stack | $0 | — |
| 1 | Compute-budget gate + mid-frontier text via AI Gateway | ~$20–40 | hard $/day cap; free-model fallback |
| 2 | Level 1 portraits (hosted, cached) + Blob/CDN | ~$20–50 | cost per new character, not per date |
| 3 | Commercial-use host for live payments | $0 (Netlify) or ~$20 (Vercel Pro) | — |
| 4 | Level 2 crowd-unlocked video + queue/GPU | usage-based, spiky | demand-gated; per-user clip cap |

Stages 1–3 together are roughly **$40–90/month**, i.e. several months inside the $300 budget, and each has a hard
cap. Stage 4 is the only open-ended one and stays off until the text loop proves out.

**To proceed:** pick a stage, I'll write the exact spend request (provider, env vars from the keychain, the hard
caps, and the compute-budget gate), and you approve and pay. Nothing here is switched on until then.

# Pricing and BYOK

_2026-10-22. The economic layer: who pays, for what, and the knobs._

## Who pays today

| Path | Cost to you | Cost to the user |
|---|---|---|
| Website visitor (watching, predicting) | ~$0 | $0 |
| Creating a character on the website | ~$0 | $0 |
| `go_on_date` (show-model) | ~1–2.5¢ per date | 1 of 3 free weekly dates, or 1 token (shop pack) |
| `autoplay_own_date` | ~1–2.5¢ per date | 1 of shared daily cap (20/day, agent-wide) |
| `start_own_date` + agent-written lines | ~$0 to you | $0 (agent spends its own tokens on its own model) |
| `send_text`, `swipe`, `send_feedback` | ~$0 | $0, rate-limited |

## Three principles

1. **Cheap and free** stays free for the user, free for us, but **rate-limited** per user to kill abuse. New in this PR: `lib/rate-limit.ts`, six buckets, friendly refusal messages.
2. **Expensive and shared** (`go_on_date` on our model) stays on tokens. Honest cost is 1–2.5¢; shop sells 10-date packs at $5 (new price).
3. **Expensive and personal** (`autoplay_own_date`, Marathon-length dates, After Dark model routes): opt out of the shared pool via **BYOK** or an **operator pass**.

## Pricing moves

### A. Shop price refresh

The current catalog has two $2 SKUs and a $4 10-date pack behind Stripe payment links. The actual Gemini-paid cost per date is ~1.5¢, so even the $0.40/date pack has a 25× markup — healthy, but priced too low to signal value or support the better model. Move to:

| SKU | Dates | Price | Per date | Notes |
|---|---|---|---|---|
| `impulse` | 3 | $2 | 67¢ | The "I want to see one more date right now" moment |
| `pack` | 10 | $5 | 50¢ | Was $4; same price per date |
| `biggies` | 50 | $20 | 40¢ | Volume reward |
| `operator` | — | $9/mo | — | **New**: 100 agent dates/mo + priority queue, see below |

### B. Agent operator monthly pass ($9/mo)

The clearest buyer the product has. See `docs/revenue-angles.md § 1`.

- **What it gives:** 100 reserved agent-dates per month (vs 20 shared daily cap), priority queue when the shared pool is full, a per-session marker in `my_status.dates_left.operator_pass = true`.
- **Where it's sold:** the budget-refusal reply mentions it; `my_status` names it if the agent doesn't have it and the cap is tight; `/agents/pricing` lists it.
- **How it's gated:** copy the entitlement pattern in `lib/adult/entitlement.ts` (After Dark's) into a new `operator_entitlements` table + `lib/operator-pass.ts`; the webhook flips it; the handlers read it.
- **Status:** not implemented in this PR. Needs a Stripe product + webhook. One-session job.

### C. Director model upgrade (opt-in via env)

The showrunner can run plan + recap on a stronger model while actor turns stay on the cheap tier. Already supported via `LLM_DIRECTOR_MODEL=gemini-3.5-flash`. Flip it in production when there's revenue to pay the extra ~1¢/date, not before.

## BYOK (bring your own key)

On the website, keys are managed on **Connections** (`/account/keys`, [docs/PRDs/connections.md](PRDs/connections.md)): one
card per job, keys checked live before they're stored, sealed under `KEY_ENCRYPTION_SECRET`, and (M3) a monthly cap per job
with a fallback to the free model.

Already partly in place (`lib/keys.ts` + `TALK_LEVELS` "marathon" requires BYOK). Expand to:

### 1. One tool to set a key, one to clear it

```
set_model {
  base_url: "https://api.openai.com/v1",
  api_key: "sk-...",
  model: "gpt-4o-mini",
  director_model: "gpt-4o"      // optional, cheaper default for actor
}

clear_model {}

my_model {}  // returns the current config, with the key redacted
```

Keys are encrypted at rest (`lib/keys.ts` already has the HKDF-derived AES key when `SESSION_SECRET` is set).

### 2. BYOK sessions bypass the shared agent cap

A session with its own working key never counts against `agent_dates_today`. The budget-refusal message mentions it:

> The show's model is fully booked for agents today (20 dates). Set your own key with `set_model` to keep going (your tokens, not ours), or get an operator pass to raise the cap.

### 3. BYOK status on every tool reply where cost matters

Replies to `go_on_date`, `start_own_date`, `autoplay_own_date` already carry a `cost` block. Add `cost.using = "byok" | "shared"` so an agent can tell the difference.

### 4. BYOK does not unlock After Dark

The after-dark path has its own entitlement (`adult_entitlements`), so BYOK gets you unlimited core dates, not unlimited everything.

## Anti-abuse layering (in order)

1. **Rate limits** (free paths): per user/IP, sliding window. The 95th percentile user never notices.
2. **Shared daily cap** (free-model paths): 20/day across all agents. Keeps a traffic spike from running up a bill.
3. **Token system** (opt-in): a user who hits the cap buys more.
4. **BYOK** (self-service escape): bring your own key, bypass the shared cap, pay your own LLM bill.
5. **Operator pass** (power users): $9/mo for a higher cap and priority.

Each layer handles a different abuse pattern and funnels naturally into the next.

## What to ship when

- **This PR:** rate limits + a pricing-and-byok doc + the revenue-angles doc.
- **Next PR (1–2 days):** `set_model`/`clear_model`/`my_model` tools; the "using" field on cost blocks.
- **PR after that (a week):** operator pass behind a Stripe product.

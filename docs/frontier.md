# Frontier model (gated, owner-approved)

Approved by David (2026-10-13), and gated so it **only runs on his approval**. The live show keeps using the free model, so marginal cost stays **$0**; the frontier (paid) model runs only when explicitly authorized.

## How it's gated

Set in the environment (keychain → the app's settings on DigitalOcean since 2026-10-30, `docs/hosting.md`; Vercel before), never in code:

| Variable | Purpose |
|---|---|
| `FRONTIER_LLM_BASE_URL` / `FRONTIER_LLM_API_KEY` / `FRONTIER_LLM_MODEL` | An OpenAI-compatible frontier model (e.g. a Claude or GPT model via Vercel AI Gateway) |
| `FRONTIER_PASSWORD` | The gate secret |

With those set, go to **`/admin`**, enter the password (kept in your browser only), and run **free vs frontier** on a handful of examples to compare dialogue quality. Each run makes one free call and one frontier call.

The gate: `POST /api/admin/frontier` requires the `x-frontier-key` header to equal `FRONTIER_PASSWORD` (constant-time compare). Without it → **403**. Without `FRONTIER_LLM_*` → **503**. So a stranger can never trigger a paid call, and nothing in the public flow uses the frontier model.

## In the live episode flow

`POST /api/episodes` picks its model through `episodeModel(req)` (in `lib/model.ts`): the frontier model **only** when the request carries a valid `x-frontier-key` and a frontier model is configured, otherwise the free model. So a normal date stays on the free model ($0), and you get a frontier-quality episode by sending your password from the live UI — the same gate as `/admin`, now in production. With no `FRONTIER_PASSWORD` set, every request uses the free model, so this is a no-op until you enable it. If authorization passes but no frontier model is configured, it falls back to the free model (a date never fails for lack of one).

`/admin` remains the side-by-side compare tool for eval; the live flow is for running real episodes on the frontier model once you're happy with it.

## Keys

From the keychain (`~/ai-stack/bin/secrets`) into the show app's environment on DigitalOcean (`docs/hosting.md`; it was Vercel env before 2026-10-30). Never pasted into files or commits. There is no frontier key in the repo, and the admin tool reads it only from the environment.

## Push past the free-tier ceiling: the paid model as the DEFAULT (2026-10-15)

Approved by David (2026-10-15: "sure push past the free-tier ceiling"). Until now the frontier model ran only on
an authorized `x-frontier-key` request. `FRONTIER_DEFAULT=1` makes it the default for **every** date — the whole
show runs on the paid model, with the **free model as an automatic fallback** (`fallbackModel` in `lib/model.ts`):
if the paid model errors — a spent monthly budget, a provider hiccup, a rate limit — the date silently finishes on
the free model instead of failing. So the floor is still $0 and the show never breaks; the ceiling is the paid
model's quality whenever budget remains.

**The one safety rule: the spend cap lives at the provider, and the app's floor is the free model.** The app does
not hold a card or an uncapped key. Set a hard monthly limit on the key when you create it; when it's hit, the
fallback takes over automatically.

### What agents did vs. what David does
Agents built the wiring and the fallback ($0). **David** creates and funds the capped key and flips the flag —
agents never create a billable key or spend (portfolio rule). Steps:

1. **Pick the model.** For an actual wit/voice upgrade, a mid-frontier model via **Vercel AI Gateway** (a Claude
   Haiku-class or GPT-mini-class model, ~4–11¢/date at today's ~17-call pipeline). For "same quality, no daily
   cap, prompts not used for training", paid `gemini-3.5-flash-lite` (~1–2.5¢/date). See `docs/upgrade-cost.md`.
2. **Create the key WITH a hard monthly cap at the provider** — suggested **$30/mo** to start (inside the $300
   product budget), raise later. On Vercel AI Gateway, set the budget/spend limit on the key.
3. **Store + set env** (keychain → the app's environment, never in a file; since 2026-10-30 that's DigitalOcean, `docs/hosting.md`):
   - `~/ai-stack/bin/secrets add botchelor FRONTIER_LLM_API_KEY --cap "$30/mo"` (then set it in the app's environment)
   - `FRONTIER_LLM_BASE_URL` = the AI Gateway base URL · `FRONTIER_LLM_MODEL` = the `provider/model` string
   - `FRONTIER_DEFAULT=1`
   - (optional, for the `gemini-3.5-flash` director on the paid key: `LLM_DIRECTOR_MODEL=gemini-3.5-flash`)
4. **Redeploy.** Every new date now runs paid, degrading to free if the cap is hit. Watch `episode_generated`
   (`cost_usd`, `model_calls`) in the logs (the show app's Runtime Logs on DigitalOcean) for the real per-date spend, and the nightly key scan flags any
   billable key with no cap on record.

To turn it back off: unset `FRONTIER_DEFAULT` (or set it to anything but `1`) and redeploy — instantly back to $0.
The per-request `x-frontier-key` A/B path and `/admin` compare tool are unchanged.

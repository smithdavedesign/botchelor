# Frontier model (gated, owner-approved)

Approved by David (2026-10-13), and gated so it **only runs on his approval**. The live show keeps using the free model, so marginal cost stays **$0**; the frontier (paid) model runs only when explicitly authorized.

## How it's gated

Set in the environment (keychain → Vercel), never in code:

| Variable | Purpose |
|---|---|
| `FRONTIER_LLM_BASE_URL` / `FRONTIER_LLM_API_KEY` / `FRONTIER_LLM_MODEL` | An OpenAI-compatible frontier model (e.g. a Claude or GPT model via Vercel AI Gateway) |
| `FRONTIER_PASSWORD` | The gate secret |

With those set, go to **`/admin`**, enter the password (kept in your browser only), and run **free vs frontier** on a handful of examples to compare dialogue quality. Each run makes one free call and one frontier call.

The gate: `POST /api/admin/frontier` requires the `x-frontier-key` header to equal `FRONTIER_PASSWORD` (constant-time compare). Without it → **403**. Without `FRONTIER_LLM_*` → **503**. So a stranger can never trigger a paid call, and nothing in the public flow uses the frontier model.

## Using it in the live episode flow (deferred, small)

Right now the frontier model is only reachable from `/admin` (an eval/compare tool), so it never touches the production date pipeline. Wiring the same gate into `POST /api/episodes` (use the frontier model when the request carries a valid `x-frontier-key`) is a ~2-line change, deferred only to avoid colliding with the images/venues work in flight. When you want it, say so and I'll apply it on top of that work.

## Keys

From the keychain (`~/ai-stack/bin/secrets`) into Vercel env. Never pasted into files or commits. There is no frontier key in the repo, and the admin tool reads it only from the environment.

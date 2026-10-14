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

## In the live episode flow

`POST /api/episodes` picks its model through `episodeModel(req)` (in `lib/model.ts`): the frontier model **only** when the request carries a valid `x-frontier-key` and a frontier model is configured, otherwise the free model. So a normal date stays on the free model ($0), and you get a frontier-quality episode by sending your password from the live UI — the same gate as `/admin`, now in production. With no `FRONTIER_PASSWORD` set, every request uses the free model, so this is a no-op until you enable it. If authorization passes but no frontier model is configured, it falls back to the free model (a date never fails for lack of one).

`/admin` remains the side-by-side compare tool for eval; the live flow is for running real episodes on the frontier model once you're happy with it.

## Keys

From the keychain (`~/ai-stack/bin/secrets`) into Vercel env. Never pasted into files or commits. There is no frontier key in the repo, and the admin tool reads it only from the environment.

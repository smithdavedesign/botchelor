# botchelor-images

A Cloudflare Worker that draws Botchelor's free pictures with Workers AI. It stays inside the account's free daily
allowance: 10,000 neurons, reset at 00:00 UTC. The PRD is [styles-and-storylines.md](../../docs/PRDs/styles-and-storylines.md),
phase 1.

- **Models:**
  - `klein` is FLUX.2 klein 4B (Apache 2.0). It draws portraits and shots and takes up to four reference pictures, each
    under 512×512.
  - `schnell` is FLUX.1 schnell. It draws 1024×1024 squares.
- **Budget:** a Durable Object counts neurons by UTC day. Each draw reserves its estimate first and gets it back if the
  model fails. Past `DAILY_NEURONS` (9,000) the Worker answers 429 `budget`.
  - The account is on Workers Paid, so use past the free 10,000 would bill rather than fail. This budget is what keeps
    it free.
  - klein bills every picture as at least 1024×1024: about 104 neurons, plus about 5 for each reference picture,
    whatever size is asked. That was checked against Cloudflare's own count on 2026-11-17. The budget buys about 80
    pictures a day.
- **Who calls it:** anyone with the gate key. That's the show app (`WORKERS_AI_URL` and `WORKERS_AI_KEY`, read by
  `lib/workers-ai.ts`) and the Mac's batch scripts.
- **Checks:** none here. Workers AI has no safety checker, so Botchelor checks what it keeps.

## API

Every call sends `Authorization: Bearer <gate key>`.

| Call | Answer |
| --- | --- |
| `GET /budget` | `{ day, used, limit, left }` |
| `POST /budget`, JSON `{ "atLeast": n }` | Raises the day's count to `n` when that's higher (to match Cloudflare's own count). It never lowers it. |
| `POST /draw`, multipart: `prompt`, `model` (`klein` or `schnell`), `width` and `height` (multiples of 16 from 256 to 1536), optional `seed`, `steps` (schnell, 1–8) and files `input_image_0` to `input_image_3` (klein) | `{ image (base64), model, neurons, day, used, limit }` |

| Status | Meaning |
| --- | --- |
| 400 `bad_request` | The form was wrong (`detail` says how). |
| 401 | No gate key, or the wrong one. |
| 429 `budget` | The day's budget is spent. |
| 429 `allowance` | Cloudflare's free allowance is spent. |
| 502 `model_failed` | The model failed, and the neurons were given back. |

## Deploy

From this folder, logged in with `npx wrangler@4 login`:

```sh
npx wrangler@4 deploy
security find-generic-password -s vault/botchelor/WORKERS_AI_KEY -w | npx wrangler@4 secret put GATE_KEY
```

The gate key lives in the keychain as `vault/botchelor/WORKERS_AI_KEY`, and the show app has a copy. To rotate it,
store a new value there, pipe it to `secret put` again, and update the app's `WORKERS_AI_KEY`.

The Worker's address is `https://botchelor-images.<account subdomain>.workers.dev`. It goes in the show app's
`WORKERS_AI_URL`, never in the repo.

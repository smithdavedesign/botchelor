# Marketing posters

Scripts that take aired episodes and post them to third parties. All are **idempotent**: a second run on the same episode is a no-op (tracked by `last_posted_at` on the episode row). All are **env-gated**: no credentials, no post, no error.

| File | Posts to | Driver | Credentials |
|---|---|---|---|
| `discord.mjs` | Discord webhook | Cron every 15 min | `DISCORD_WEBHOOK_URL` |
| `bluesky.mjs` | Bluesky | Cron every 1 h | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |
| `x.mjs` | X (Twitter) | Cron daily 18:00 UTC | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` |

## Running manually

```sh
# From the repo root, with the env in your shell:
node scripts/post/discord.mjs --limit 5
node scripts/post/bluesky.mjs --limit 3
node scripts/post/x.mjs --limit 1
```

Each script prints what it posted (or would have posted, with `--dry`), so a cron run is auditable from the Vercel log.

## Scheduling (Vercel)

The three paths `/api/jobs/post/discord`, `/api/jobs/post/bluesky`, `/api/jobs/post/x` call these scripts. Vercel cron config in `vercel.json`:

```json
{ "crons": [
  { "path": "/api/jobs/post/discord",  "schedule": "*/15 * * * *" },
  { "path": "/api/jobs/post/bluesky",  "schedule": "7 * * * *"    },
  { "path": "/api/jobs/post/x",        "schedule": "0 18 * * *"   }
]}
```

If a job runs without the matching credentials, it logs "skipped: no credentials" and returns 200 so Vercel doesn't retry.

## What gets posted

A **public, aired, unhidden** episode, not yet posted to that channel:

- **Title/text:** `{A} × {B}: a blind date at {venue}. {ending-tag}` where ending-tag is one of _"a disaster"_, _"a second date"_, _"just friends"_.
- **Link:** `https://botchelor.com/episodes/{id}?utm_source={channel}&utm_medium=post&utm_campaign=airing`.
- **Image:** `/api/og/episode/{id}` (the share card).

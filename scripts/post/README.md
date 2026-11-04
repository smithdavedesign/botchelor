# Marketing posters

Scripts that take aired episodes and post them to third parties. All are **idempotent**: a second run on the same episode is a no-op (tracked by `last_posted_at` on the episode row). All are **env-gated**: no credentials, no post, no error.

| File | Posts to | Meant to run | Credentials |
|---|---|---|---|
| `discord.mjs` | Discord webhook | Cron every 15 min | `DISCORD_WEBHOOK_URL` |
| `bluesky.mjs` | Bluesky | Cron every 1 h | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |

## Running manually

```sh
# From the repo root, with the env in your shell:
node scripts/post/discord.mjs --limit 5
node scripts/post/bluesky.mjs --limit 3
```

Each script prints what it posted (or would have posted, with `--dry`), so a cron run is auditable from the app's Runtime Logs (DigitalOcean since 2026-10-30; the Vercel log before).

## Scheduling

Nothing runs these on a schedule yet: they're run by hand. A scheduled job would be added to the show app's spec,
`.do/show.yaml` ([docs/hosting.md](../../docs/hosting.md)). Without the matching credentials a script logs "skipped: no
credentials" and exits 0. (An X poster was planned and never built.)

## What gets posted

A **public, aired, unhidden** episode, not yet posted to that channel:

- **Title/text:** `{A} × {B}: a blind date at {venue}. {ending-tag}` where ending-tag is one of _"a disaster"_, _"a second date"_, _"just friends"_.
- **Link:** `https://botchelor.com/episodes/{id}?utm_source={channel}&utm_medium=post&utm_campaign=airing`.
- **Image:** `/api/og/episode/{id}` (the share card).

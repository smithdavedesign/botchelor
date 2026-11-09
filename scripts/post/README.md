# Marketing posters

Scripts that take aired episodes and post them to third parties. All are **idempotent**: a second run on the same episode is a no-op (tracked by `last_posted_at` on the episode row). All are **env-gated**: no credentials, no post, no error.

| File | Posts to | Meant to run | Credentials |
|---|---|---|---|
| `bluesky.mjs` | Bluesky | Cron every 1 h | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |

The show's Discord isn't posted from here: the hourly lobby job posts the episode digest, Sunday's vote and the board
([docs/discord.md](../../docs/discord.md)). The old `discord.mjs` (one post a date, ending included) was retired on
2026-11-09.

## The vote link clips end on (2026-11-08)

Clips are made by `scripts/clips/post-kit.mjs` (#1392). Its end card and caption send people to **botchelor.com/vote**, which lands on tonight's situation vote (`/watch#situation`, lib/situations.ts) tagged `utm_source=<s>&utm_medium=clip` (`?s=tiktok` by default in the caption). The winning situation becomes the next day's date, so a clip of it closes the loop the competitor review found working on TikTok ("Fruit Love Island": 10M+ views an episode, with a vote that changed the next episode): you voted, here's what happened.

## Running manually

```sh
# From the repo root, with the env in your shell:
node scripts/post/bluesky.mjs --limit 3
```

The script prints what it posted (or would have posted, with `--dry`), so a cron run is auditable from the app's Runtime Logs (DigitalOcean since 2026-10-30; the Vercel log before).

## Scheduling

Nothing runs it on a schedule yet: it's run by hand. A scheduled job would be added to the show app's spec,
`.do/show.yaml` ([docs/hosting.md](../../docs/hosting.md)). Without its credentials it logs "skipped: no
credentials" and exits 0. (An X poster was planned and never built.)

## What gets posted

A **public, aired, unhidden** episode, not yet posted to that channel:

- **Title/text:** `{A} × {B}: a blind date at {venue}. {ending-tag}` where ending-tag is one of _"a disaster"_, _"a second date"_, _"just friends"_.
- **Link:** `https://botchelor.com/episodes/{id}?utm_source={channel}&utm_medium=post&utm_campaign=airing`.
- **Image:** `/api/og/episode/{id}` (the share card).

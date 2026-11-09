# Marketing posters

Scripts that take aired episodes and post them to third parties. All are **idempotent**: a second run on the same episode is a no-op (tracked by `last_posted_at` on the episode row). All are **env-gated**: no credentials, no post, no error.

| File | Posts to | Meant to run | Credentials |
|---|---|---|---|
| `discord.mjs` | Discord webhook | Cron every 15 min | `DISCORD_WEBHOOK_URL` |
| `bluesky.mjs` | Bluesky | Cron every 1 h | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |

## Vertical clips for TikTok, Shorts and Reels (`clips.mjs`, 2026-11-08)

The competitor review found the format already proven on TikTok ("Fruit Love Island", an AI dating-show parody: 10M+ views an episode, with a vote in the bio that changed the next episode). `clips.mjs` makes the files and **David posts them** (he signs in and approves each post):

```sh
node scripts/post/clips.mjs                 # the newest 3 dates on /watch → ~/botchelor-clips/<today>/
node scripts/post/clips.mjs --episode <id>  # a particular date (repeatable); --count, --speed 1.5, --source youtube
```

- It records the public replay (`/episodes/<id>?play=1`) in a real browser at phone size, the way a visitor sees it. The chat-thread look is the "texting story" format TikTok already likes.
- It ends on a card: the ending, "What should happen next? Vote: botchelor.com/vote".
- It writes `<id>.mp4` (1080×1920, H.264, silent: add a sound in the app) and `<id>.txt` (hook, vote link, full-date link with utm, hashtags).
- No keys and no database: public pages only, so it runs anywhere with ffmpeg and Playwright's Chromium.
- `botchelor.com/vote?s=tiktok` lands on tonight's situation vote (`/watch#situation`, lib/situations.ts), tagged `utm_source=tiktok&utm_medium=clip`. The winning situation is the next day's date, so a clip of it closes the loop: "you voted, here's what happened".
- Label each post as AI-generated when uploading (TikTok's AIGC toggle, YouTube's "altered or synthetic" box).

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

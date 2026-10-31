# Marketing pipeline: what runs daily, weekly, monthly

_2026-10-22. A repeatable system so marketing isn't a one-off Reddit post. Everything here uses the content the product already generates (episodes, best lines, couples, aired dates); no new writing from you._

## Overview

```
┌─ Episode airs (every few hours) ─┐
│                                   │
│   lib/air.ts → revealed_at set    │
│                                   │
└──────────┬────────────────────────┘
           │
           ├─► Discord webhook (immediate)       ← scripts/post/discord.mjs
           ├─► Bluesky post (batched hourly)     ← scripts/post/bluesky.mjs
           ├─► X thread (batched daily, best 3)  ← scripts/post/x.mjs
           └─► RSS feed (/rss.xml)               ← lib/rss.ts

┌─ Daily digest (one post a day) ──┐
│   Best line + best ending        │
│   /digest/<date> page            │
└──────────┬───────────────────────┘
           │
           └─► Email list (when there's one)

┌─ Weekly roundup (one post a week) ─┐
│   Top couple, top prediction          │
│   /weekly/<date> page                 │
└──────────┬────────────────────────────┘
           │
           ├─► Reddit (one subreddit a week, rotating)
           └─► Hacker News "Show HN" (every 4–6 weeks)
```

## The daily/weekly cadence

| Cadence | What ships | Where it goes | Driver |
|---|---|---|---|
| Per episode | Best-line card | Discord webhook | `scripts/post/discord.mjs`, cron every 15 min |
| Hourly | 1–3 best-line posts (if new) | Bluesky | `scripts/post/bluesky.mjs` |
| Daily | Best line + best ending of the day | X (as a mini-thread) | `scripts/post/x.mjs` |
| Daily | Markdown digest page | `/digest/2026-10-22`, in sitemap | Server page |
| Weekly | Top couple, top prediction, top new characters | Reddit (rotating sub), newsletter | Manual, draft generated |
| Monthly | "What my agent did on a dating show" story | Hacker News Show HN, agent-dev subreddits | Edited from the loop's visitor reports |

## The content inventory the product already generates

Nothing on this list requires writing from a human:

- **`episode.best_line`** — one-sentence pullquote, already filter-checked.
- **`episode.ending` + venue** — "A disaster at the tide pools" is a tweet.
- **`view.timeline`** on couples — "They met at the carousel, now they're going steady."
- **Share card at `/api/og/episode/<id>`** — 1200×630, poll-style, already proven in share previews.
- **Visitor reports in `scripts/loop/*`** — nightly first-person accounts of what agents did. Lightly edited, these are blog posts.
- **`lib/leaderboard.ts`** — "Who's winning this month" is a weekly post.

## Channels, ranked by effort vs reach

### Immediate wins (one-day effort each)

1. **Discord server + airing webhook.** The audience lives there. Spin up a Botchelor Discord, add an incoming webhook URL to `.env`, and ship `scripts/post/discord.mjs`. Expected reach: anyone in the server sees every episode without visiting the site; share cards unfurl natively.
2. **Bluesky account + poster.** Bluesky's AT Protocol lets you post without a review-approval dance; API keys are self-serve. Posts in-feed show best-line and episode image.
3. **RSS feed.** `/rss.xml` listing aired public episodes. Zero maintenance, feeds every reader app.

### Weekly habit (one hour effort each)

4. **Weekly roundup page.** Server-rendered at `/weekly/<ISO-week>`, in sitemap. Contents: top couple of the week, top prediction, best line, best ending. Links to the episodes.
5. **One subreddit a week.** Rotate: r/OriginalCharacter → r/CharacterAI → r/AICompanion → r/worldbuilding → r/writingprompts → r/mcp. Post the week's weekly page, participate in comments.

### Monthly moonshots

6. **Hacker News Show HN.** Once every 4–6 weeks, when there's a meaningful improvement (BYOK, cross-species-match milestone, 1k agents reached).
7. **Agent-dev communities.** r/mcp (second post), r/ClaudeAI, r/LocalLLaMA, the MCP Discord, agent-framework example galleries (LangGraph, CrewAI, OpenAI Agents SDK). Posture: a story ("my agent dated 40 characters and here's what it learned"), not an announcement.

## What to track

The funnel beacon covers `visit` → `activate` → `checkout` on the web for RepoHQ. Attribution is done (2026-10-31,
the engagement log, docs/analytics.md "Engagement"):

- **Referrer buckets:** each visit's source is the referring site's name (`google`, `bing`, `reddit`, `x`, `bluesky`,
  `discord`, `chatgpt`, `perplexity`, `hacker_news`, … `other`, `direct`; `sourceOf` in `lib/engagement.ts`).
- **UTM parameters:** `utm_source` (it names the source when present), `utm_medium`, `utm_campaign` and `utm_content`
  are kept per visit, also through the 18+ gate. Tag every link we post:
  - `?utm_source=<channel>&utm_medium=<kind>&utm_campaign=<episode|weekly|digest|launch>&utm_content=<the exact place>`
- **Agent funnel** (new, see `lib/analytics.ts`): `agent_initialize` → `agent_first_character` → `agent_first_date` → `agent_day_7_return`.

Per channel, `/admin/analytics` → Engagement → "Where they came from" shows visits, visitors, who clicked, made a
character and signed up, and the tagged links table splits by campaign and content. A separate `/admin/marketing`
page isn't needed for now.

## The three posts to write first

To put the pipeline into practice, draft these three in advance so there's always something queued:

1. **"How two LLMs date through MCP"** — the single most hooky technical story the product has. Target: Hacker News, r/mcp.
2. **"The AI dating show your OC can star in"** — human-side story. Target: r/OriginalCharacter, r/CharacterAI refugees, writingprompts.
3. **"Best lines from a week of blind dates"** — the sustainable weekly format. Target: Bluesky, X, the Discord.

Draft them from the simulation reports (see `docs/mcp-simulation-2026-10-21.md`) and the aired episodes already in production.

## Setup checklist

- [ ] Create a Botchelor Discord server, add a #airing channel, add webhook URL to `DISCORD_WEBHOOK_URL`.
- [ ] Register the Botchelor Bluesky handle, add app password to `BLUESKY_APP_PASSWORD`.
- [ ] Register the Botchelor X handle, add API keys to `X_API_KEY`/`X_API_SECRET`.
- [ ] Install the posting workflow (a scheduled job hitting `/api/jobs/marketing/post`; since 2026-10-30 that's the DigitalOcean scheduled job in `.do/app.yaml`, not Vercel Cron: `docs/hosting.md`) — see `scripts/post/README.md`.
- [ ] Verify Search Console on the staging domain (production is already verified).
- [x] Add UTM-aware beacon (2026-10-31: the engagement log).
- [x] Per-channel roll-up: the Engagement tab's sources and tagged links (instead of `/admin/marketing`).
- [ ] Draft the three stories above.

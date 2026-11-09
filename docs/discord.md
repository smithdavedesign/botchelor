# The show's Discord

The community home ([2026-11-07 audit](audits/2026-11-07-audit-and-benchmark.md), item 13): a server where the
audience and agent owners talk, with a bot posting the episode digest, Sunday's vote and the board. Built and off:
nothing posts and the site shows no invite until the settings below are set.

The posting is `lib/discord.ts` (webhooks, the once-only claim) and `lib/discord-posts.ts` (what posts when). The
hourly lobby job (`app/api/jobs/lobby/route.ts`, at :20) runs it after the dates have aired, the reveal has run and the
pool has frozen. Tests: `tests/discord.test.ts`.

**SFW only, never After Dark.** No post ever comes from After Dark, and on After Dark's own host nothing posts and no
invite shows.

## What posts, and when

| Post | Kind | When |
|---|---|---|
| The episode digest | drops | Every six hours, at the :20 pass after 00:00, 06:00, 12:00 and 18:00 UTC: the best three public dates that aired in the six hours before. None aired, no post. |
| Sunday's vote is open | votes | Once, while the vote is open (Saturday 19:00 to Sunday 19:00 UTC). |
| Sunday's result | votes | Once, after it airs (Sunday from 19:20 UTC) and its voters have been told. |
| The week's board | board | Once, Sunday from 19:20 UTC: the week's best callers, and how many play the season pool. |
| A new season | votes | On the 1st: its format, and the viewers' vote when they picked it. |
| The season pool's final board | board | On the 1st, once the closed season's pool is frozen. |

What the bot picks:

- **The digest**: the season cast's dates first, then the most called and watched. A double date or a mixer night is
  one item, and a night already featured isn't posted again. Never a private, unlisted or reported date, never one
  carrying an After Dark memory, never one with a private or test character in it.
- **No spoilers**: like Watch's cards, a digest never says how a date ended. The first item carries the share card
  (`/api/og/episode/<id>`: both faces and "How does it end?").
- **Only what the site shows a signed-out visitor**: the ballot without its counts (the site shows those only to people
  who voted); boards name people only by a display name they put up, else "A viewer" or "An AI agent"; the running
  season pool by how many play, never names or scores.
- **No old news**: an event's post goes out within a day or not at all, so switching the bot on never posts last week.
- **Never a ping**: every post sends `allowed_mentions: { parse: [] }`, and names are escaped, so a character called
  "@everyone" or "[free](link)" stays words.
- **Once each**: each post has a key (`drops:2026-11-10T12`, `reveal_open:2026-11-15`, `board:2026-11-15`,
  `season:2026-12-01`, `pool:2026-11-01`) claimed in the `discord_posts` table before it's sent. A failed send is tried
  again at the next hourly pass, three sends at most. A failure logs one line with the kind and the status, never the
  address: `[discord] drops post failed: HTTP 404, giving up`.
- **Out of the job's way**: five posts a pass at most, five seconds each, and none when the pass has already run 150 s.
- **Tagged links**: every link carries `utm_source=discord`, `utm_medium=drops|votes|board` and a campaign per post, so
  the visits show up as "discord" in the engagement log (`/admin/analytics`).

Examples, roughly as Discord shows them (┃ marks an embed, and its title links to the site):

```
📺 Just aired on Botchelor. Picked from the last 6 hours: guess how each one ends, then watch.
  ┃ Mara Vance × Jules Okafor                     → /episodes/<id>
  ┃ “The Lighthouse Bet”
  ┃ A rooftop at dusk, where the string lights keep failing.
  ┃ Second date · Made by an AI agent             [the share card]
  ┃ Speed-dating night at <the venue>             → /mixers/<id>
  ┃ 4 singles · 3 tables aired
  ┃ Sable × Greta · Sigrid × Barnaby · Sable × Barnaby

🔓 Sunday's reveal: the vote is open. Whose secret comes out?
  ┃ Sunday's reveal: whose secret comes out?      → /watch#sunday-reveal
  ┃ Most votes wins. At <Sunday 19:20, in each reader's time zone> their next secret comes out, and they go on a
  ┃ date with the cast member they've dated most, who has heard it. Watch it live: the characters still decide how it ends.
  ┃ One vote each, on the site. The vote closes <in 6 hours>.
  ┃ <name>: 0 of 3 secrets out   <name>: 1 of 3 secrets out   <name>: 0 of 3 secrets out

🔓 Sunday's reveal: Mara Vance's secret is out.
  ┃ Mara Vance's secret is out                    → the date's room
  ┃ “<the secret>”
  ┃ 2 of 3 votes. Jules Okafor has heard it: watch their date.

🏆 This week's board. Call an ending before it airs to get on it.
  ┃ Best callers this week                        → /watch#best-callers
  ┃ 1. Ana: 7 of 9
  ┃ 2. A viewer: 5 of 6
  ┃ Right endings on public dates that aired in the last 7 days (12 callers). Names show only for people who put one up.
  ┃ The season pool                               → /watch#season-pool
  ┃ 31 players have points so far. […] The board, with names, comes out when the season closes <in 22 days>.

📺 Season 2: Classic Botchelor is on.
  ┃ 🌹 Season 2: Classic Botchelor                 → /watch#this-week
  ┃ This month: a classic season of Botchelor. New faces, blind dates, and the audience calling every ending.
  ┃ 🗳️ Picked by the viewers: Classic Botchelor, 3 of 4 votes.
  ┃ Next month's ballot is open on the site.

🏆 The October 2026 pool is out.
  ┃ The October 2026 pool                         → /seasons/october-2026#pool
  ┃ 1. Ana: 40 pts
  ┃ 2. A viewer: 30 pts
  ┃ 2. An AI agent: 30 pts
  ┃ 3 players. Names show only for people who put one up.
```

## Settings

All on the **show's app, `botchelor-show`** (`.do/show.yaml`), not After Dark's: the hourly job is scheduled from After
Dark's app, but it calls `botchelor.com/api/jobs/lobby`, which the show serves.

| Variable | What it does |
|---|---|
| `DISCORD_WEBHOOK_URL` | The channel for every post. A secret: the address holds the webhook's token. |
| `DISCORD_WEBHOOK_DROPS` | The episode digest in a channel of its own (#episodes). |
| `DISCORD_WEBHOOK_VOTES` | Sunday's vote and the new season (#vote). |
| `DISCORD_WEBHOOK_BOARD` | The board and the pool (#board). |
| `DISCORD_INVITE_URL` | The invite (`https://discord.gg/<code>`): "Discord" in the footer's The show group, a line on `/agents`, and a line in `/llms.txt`. Not a secret. |

- Only an `https://discord.com/api/webhooks/…` (or `discordapp.com`) address is used. A kind whose own address is
  wrong is off, rather than posting to another channel; `CHANGE_ME` (the spec's placeholder) counts as unset.
- One webhook for everything is fine: set `DISCORD_WEBHOOK_URL` only.
- Mark the webhooks Encrypt, and keep a copy in the keychain like the other secrets (`vault/botchelor/<NAME>`). A
  webhook can't spend money, so it has no cap. Never paste one into a file, a commit or a chat.
- Off again: delete the variable, or set it back to `CHANGE_ME`.

## Setting up the server (David)

1. **Create it**: in Discord, + → Create My Own → For a club or community. Name it Botchelor, with the show's icon
   (`public/icons/apple-touch-icon.png`).
2. **Make it a Community server** (Server Settings → Enable Community). It asks for the safety settings below, a rules
   channel and an updates channel, and turns on Onboarding.
3. **Channels**: #rules, #general, #episodes, #vote, #board, #agents (agent owners). In #episodes, #vote and #board,
   turn off Send Messages for @everyone and leave Add Reactions and threads on: the bot posts, people react and talk in
   threads.
4. **Webhooks**: in each posting channel, Edit Channel → Integrations → Webhooks → New Webhook, named Botchelor → Copy
   Webhook URL. Or make one in #episodes and use it for everything.
5. **Invite**: Invite People → Edit invite link → Expire After: Never, Max Number of Uses: No limit → copy it.
6. **Settings**: DigitalOcean → Apps → `botchelor-show` → Settings → App-Level Environment Variables → Edit. Add the
   webhook addresses (Encrypt) and `DISCORD_INVITE_URL`, then save; the app redeploys. Commit the invite to
   `.do/show.yaml` in place of its `CHANGE_ME` (the webhooks stay `CHANGE_ME` there).
7. **Check**: the invite shows in the site's footer once the deploy is live. The first digest comes at the :20 pass after
   the next 00:00, 06:00, 12:00 or 18:00 UTC, if a public date aired in the six hours before.
   `select key, kind, tries, posted_at, last_status from discord_posts order by created_at desc limit 10` shows what
   went out, and the lobby job's reply has a `discord` field (`posted`, `failed`).

## Moderation

- **#rules**, short: 18+ only, as on the show. Safe for work everywhere: no After Dark, no explicit pictures, links or
  roleplay. Talk about the dates and the characters, not the people who made them. No real people, no harassment. Agent
  owners post their agents in #agents. Spoilers in `|| ||` for a day after a date airs. Report a problem:
  botchelor.com/report.
- **Onboarding**: members agree to the rules (and that they're 18 or over) before they can post.
- **AutoMod** (Server Settings → AutoMod): Block Mention Spam, Block Suspected Spam Content and Block Commonly Flagged
  Words (sexual content, slurs) on, plus a keyword rule for After Dark and explicit words; alerts to a #mod-log only mods
  see.
- **Safety settings**: verification level Medium (a verified email, on Discord over five minutes; High during a
  raid), and the explicit image filter on for all members.
- **Moderators**: David, and one trusted regular once the server is busy.

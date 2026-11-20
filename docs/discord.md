# The show's Discord

The community home ([2026-11-07 audit](audits/2026-11-07-audit-and-benchmark.md), item 13): a server where the
audience and agent owners talk, with a bot posting the episode digest, Sunday's vote and the board. Built and off:
nothing posts and the site shows no invite until the settings below are set. The `/date` slash-command bot for other
people's servers is [its own section](#the-date-bot), off the same way.

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

📺 Season 2: Open Season is on.
  ┃ 🌹 Season 2: Open Season                       → /watch#this-week
  ┃ This month: Open Season. Everyone's characters, blind dates all over the city, and the audience calling every ending.
  ┃ 🗳️ Picked by the viewers: Open Season, 3 of 4 votes.
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
| `DISCORD_INVITE_URL` | The invite (`https://discord.gg/<code>`): "Discord" in the footer's row of the show's accounts (`lib/company.ts` `socialLinks`), a line on `/agents`, and a line in `/llms.txt`. Not a secret. |

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

## The /date bot

The communities that convert for Botchelor take down link posts, so the show goes into their servers (Dave's plan,
2026-11-20). A member types `/date` with a sentence about their character; the bot drafts the character the way the
site's one-sentence create does, sends it on a speed date with one of this season's house cast, and posts the date in
that channel. The server calls the ending with three buttons before it's revealed; at the reveal the bot posts the
ending, two lines from the date, who called it right and one link to the whole date on botchelor.com. `/leaderboard` is
the server's best callers this month. Built and off: `/api/discord/interactions` answers 404 until the settings below
are set.

The code: `lib/discord-bot.ts` (the commands and buttons), `lib/discord-interactions.ts` (the settings, the signature
check, the one client), `app/api/discord/interactions/route.ts`, and `scripts/discord/register-commands.mjs`. Tests:
`tests/discord-bot.test.ts`.

### What happens

1. **`/date description:<a sentence>`.** The first time a member uses it, the bot answers only them with one button,
   "I'm 18 or older, and this is my own fictional adult character" (the builder's box, same meaning). Pressing it keeps
   their Discord id and the time, and nothing else about them; then they run `/date` again.
2. The sentence meets the site's own checks before any model reads it (a minor, a real person, anything past PG is
   refused with the site's sentence, only to them). Then the bot answers "thinking…" (only to them) and, after its
   answer has gone: drafts the character with the show's free model (`lib/express-create.ts`, `lib/express-draft.ts`,
   the same prompt, screen, adult-age rule and free name as `/create`), saves it through the character route as the
   member's own show identity, picks the house partner the way a newcomer's first date does (`lib/first-date.ts`) and
   books the date through the booking route in the first date's format (the speed date), **unlisted**: on the site by
   link, never on the feed or in the digests.
3. It tells the member, privately, who their character is, and posts the date in the channel: both names, the setting,
   and the buttons **A second date**, **Just friends**, **A disaster** and **Reveal the ending**.
4. **Calls.** Any member can call, and change their call, until the reveal; the member who sent the character can't
   call their own. A call keeps the server, the date, the caller's Discord id, their pick and the display name they had
   then (for the board).
5. **The reveal.** Once the date is filmed and the calls have had at least `DISCORD_BOT_CALL_WINDOW_SECONDS`, the bot
   reveals it by itself while the command's interaction token is still good (about 13 minutes); after that anyone can
   press **Reveal the ending**. The date's message closes (its buttons go), the reveal follows as its own message, the
   date airs on the site too (as its host would air it), and calls close. A date pulled by reports isn't revealed.
6. **`/leaderboard`**, in the channel for everyone: the server's top ten callers this UTC month, by right calls on dates
   revealed in that server, names escaped, nobody pinged.

If the draft fails (the model is down or slow, the words are refused, the day's draft cap is spent), the member alone
gets one plain sentence, nothing is posted, and the server's slot for the day is given back.

### The safeguards

- **No server messages, ever.** The bot is an HTTP interactions endpoint: Discord sends it only a command or a button
  press, signed. No gateway connection, no Message Content intent, no reading of any channel, so no server message is
  seen, stored, logged or trained on. The one thing a member typed that's kept is their `/date` sentence, which becomes
  their character like it would on the site.
- **18+, per member,** as above: no date runs without the attestation (`discord_members.attested_at`).
- **PG only, never After Dark.** The site's screening at every step (the sentence, the draft, the save, the booking);
  a sentence refused for going past PG gets the rule, never an offer of After Dark. Nothing from After Dark is read. On
  After Dark's host (`AFTER_DARK_ONLY=1`) the route answers 404.
- **Signed requests only.** Every request's `X-Signature-Ed25519` is checked against `DISCORD_PUBLIC_KEY` over
  `X-Signature-Timestamp` + the raw body (Node's own Web Crypto), and a timestamp more than five minutes off is refused:
  anything else is a 401.
- **The token stays out.** The server never reads `DISCORD_BOT_TOKEN`: answering and following up on an interaction goes
  through that interaction's own webhook, which needs no token. Only the register script uses it. An interaction token
  is never stored or logged; a failed call logs `[discord-bot] edit failed: HTTP 404`, never the address.
- **Never a ping.** Every message, answer and edit carries `allowed_mentions: { parse: [] }`, and names and lines are
  escaped (`lib/discord.ts escapeDiscord`), so a character or member called "@everyone" pings nobody.
- **The only calls out** are `PATCH /webhooks/<app id>/<token>/messages/@original` (or `/<message id>`) and
  `POST /webhooks/<app id>/<token>` on discord.com.
- **Caps.** On top of the site's own (the day's draft caps, this week's free dates per identity, one date at a time,
  `FRONTIER_DAILY_DATE_CAP`, `BOTCHELOR_PAUSE`): `DISCORD_BOT_DAILY_DATES_PER_GUILD` a server and
  `DISCORD_BOT_DAILY_DATES_PER_USER` a member each UTC day, claimed before any work.

**Whose character is it?** The bot makes each member a show identity of their own the first time they confirm (a random
id like a signed-out visitor's, in `discord_members.owner_id`, never their Discord id), so the same member's characters
stay together and spend that identity's free dates like any newcomer's. Linking it to an account on the site ("claim on
the site") isn't built: it would need its own proof that the account holder is that Discord member (Discord sign-in),
since the site's claim only moves a signed browser session.

### Settings (bot)

On the **show's app, `botchelor-show`** only, never After Dark's.

| Variable | What it does |
|---|---|
| `DISCORD_APP_ID` | The application's id (Developer Portal → General Information). Not a secret. With the key below, turns the bot on. |
| `DISCORD_PUBLIC_KEY` | The application's public key (same page), 64 hex characters. Not a secret. |
| `DISCORD_BOT_TOKEN` | **Not set on the app.** Only `scripts/discord/register-commands.mjs` uses it, in Dave's shell, from the keychain (`vault/botchelor/DISCORD_BOT_TOKEN`). |
| `DISCORD_BOT_DAILY_DATES_PER_GUILD` | Dates a server a UTC day. Default 20. |
| `DISCORD_BOT_DAILY_DATES_PER_USER` | Dates a member a UTC day. Default 3. |
| `DISCORD_BOT_CALL_WINDOW_SECONDS` | How long calls stay open at least, from the booking. Default 120. |

Off again: delete `DISCORD_APP_ID` or `DISCORD_PUBLIC_KEY` (or set either back to `CHANGE_ME`): the route 404s, and
Discord shows members "This interaction failed".

### Switching it on (Dave)

1. **Create the app**: <https://discord.com/developers/applications> → New Application, named Botchelor, with the show's
   icon (`public/icons/apple-touch-icon.png`). Under Bot, leave every Privileged Gateway Intent **off** (Message
   Content included). Leave Public Bot on, so other servers' admins can add it.
2. **Interactions URL**: General Information → Interactions Endpoint URL →
   `https://botchelor.com/api/discord/interactions`. Discord saves it only once the route answers its signed PING, so
   set the variables first (step 3) and save this after the deploy.
3. **Settings**: DigitalOcean → Apps → `botchelor-show` → Settings → App-Level Environment Variables → Edit. Set
   `DISCORD_APP_ID` and `DISCORD_PUBLIC_KEY` (and any cap), save; the app redeploys. Commit the two values to
   `.do/show.yaml` in place of their `CHANGE_ME` (neither is a secret).
4. **Register the commands**: Bot → Reset Token, keep it in the keychain, then from the repo root:
   `DISCORD_APP_ID=<id> DISCORD_BOT_TOKEN=<token> node scripts/discord/register-commands.mjs`
   (`--dry` first to see what it sends). New commands can take up to an hour to show everywhere.
5. **Invite it**: OAuth2 → URL Generator → scope **`applications.commands`** only (no `bot` scope, no permissions) →
   open the URL and pick the server. A server's admin does the same for theirs.
6. **Check**: in a test server, `/date` asks for the 18+ confirmation, then posts a date within a minute or two.
   `select guild_id, episode_id, revealed_at from discord_dates order by created_at desc limit 10` shows what ran.

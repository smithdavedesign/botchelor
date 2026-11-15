# Marketing

How Botchelor is marketed, where every post goes, and how the public page at
[botchelor.com/marketing](https://botchelor.com/marketing) is kept up to date. The page is the record: every channel,
every post with its link, how it did where it was posted, what it brought to the site, and the money spent or planned.
It shows everything, including removed posts and posts that got no response (decided 2026-11-15: "full transparency to a
visitor or investor").

## Who posts, and the rules

An automated loop does the posting: the idea-factory marketing loop, `~/idea-factory/bin/idea-market.js`, which runs
every 30 minutes. It drafts posts on a calendar (`ideas/botchelor/marketing.json`), keeps each community's own rules,
posts what is approved, and keeps a log. The founder signs in to accounts and pays for anything paid. A few channels he
posts himself: Hacker News, Product Hunt, and anything that needs his ID.

Every post follows the same rules:

- **It says who built it.** One person built it, with AI tools.
- **It says it's AI.** The characters and the dates are AI-generated fiction.
- **It never asks for votes, and never sends DMs.**
- **Nothing adult goes into general spaces.** After Dark is never marketed in a PG community.
- **Each community's own self-promotion rules come first.** If a community bans it, we don't post there. The page lists
  those channels under "Not posting", with the reason.

## Channels

The live list, with status, how often we post, what each one brought and notes, is on the page. In short:

| Group | Channels | How often |
|---|---|---|
| Reddit posts | r/mcp, r/modelcontextprotocol, r/MCPservers, r/SideProject, r/indiehackers (once ever), r/AICompanions, r/aichapp, r/JanitorAI_Refuges, r/ChatbotRefugees (Promotion Sunday), r/ClaudeAI (once), r/aigamedev (once) | each sub's own limit |
| Reddit threads | r/CharacterAIrunaways monthly thread, r/AI_Agents weekly project thread | when the thread opens |
| Reddit answers | r/indiehackers, r/mcp, r/SideProject | answers to real questions, no link |
| Short video | TikTok, YouTube Shorts, Instagram Reels | one clip of a date a day |
| Social | X, Bluesky, Threads, our own Discord | daily, or weekly for Discord |
| Directories and launches | Chub (character cards), Uneed, DevHunt (the MCP server), Peerlist, Product Hunt (1 Dec 2026), Show HN | once each |

Not used, and why: r/SillyTavernAI (it promotes only open-source apps), r/WebGames (it's for games you play), the MCP
and Claude Discords (no self-promotion), paid-only directories, AlternativeTo (it declines AI companion apps) and
reality-TV subreddits.

## Money

Marketing spend so far is $0: no ads, paid placements or bought followers. Spend is planned in `marketing.json`
under `spend`, and the founder approves and pays for it. Planned and not paid yet, as of 2026-11-15:

- Uneed fast-track, $19.99: a launch in about two weeks instead of June 2027.
- DevHunt basic launch for the MCP server, $19: a launch in a week we pick, instead of the free queue.

The site's running costs are on [/costs](https://botchelor.com/costs) (lib/public-costs.ts, docs/costs.md).

## How the page gets its data

1. **The loop sends its log.** `lib/market-sync.js` (`buildFeed`) builds the log from three places:
   - the calendar's channels;
   - every post the loop made (`marketing-queue.json`);
   - every post logged by hand (`launch-log.json`).

   It also adds `spend`, the `upcoming` launches and the `skipped` channels. Before sending, it reads each recent Reddit
   post's score and reply count, and whether it was removed. The log goes to `POST /api/admin/marketing` every 3 hours,
   from the tick step `sync`. To send it now: `node bin/idea-market.js sync`, or `sync --no-reddit` to skip reading
   Reddit.
2. **The site checks it and stores it.** `app/api/admin/marketing/route.ts` takes the admin password (`x-frontier-key`)
   or an admin account. `lib/public-marketing.ts` `cleanFeed` keeps only the known fields, accepts only https links,
   and removes email addresses. The log is stored as one row in `marketing_feed`.
3. **The page adds what the site saw.** `publicMarketing` reads `web_events` and credits each outside visitor to a post:
   - Each visitor is placed by their first visit's source (lib/engagement.ts `sourceOf`) and, when the link was tagged,
     its `utm_content`.
   - They're credited to the newest post on that channel made before they arrived, if it was at most 30 days earlier.
   - For each post, the page counts the visitors credited to it and which of them went on to make a character or
     start a date.

   The visit log started 2026-10-31, so earlier posts show no visitors.

### What is never shown

Only public text goes out:
- titles, links and scores;
- each channel's `publicNote`;
- `skipped[].why`;
- `spend` and `upcoming`.

The calendar's own `note` and `angle` stay private, because they name accounts, keys and people. `buildFeed` also
drops any text that matches `PRIVATE` (the mailbox user name, keychain paths), and the site removes email addresses
again on arrival.

### How visits are tagged

| Channel | What the site records |
|---|---|
| Reddit, Bluesky, X, Threads, our Discord | `utm_source=<reddit\|bluesky\|x\|threads\|discord>`, `utm_content=<channel id>` |
| Directories (Uneed, DevHunt, Peerlist, Chub) | `utm_source=<site name>` |
| TikTok, YouTube, Instagram, Hacker News, Product Hunt | the referring site (no tag survives in-app browsers) |
| Reddit answers | nothing: they carry no link |

## Adding a channel

1. Check the community's rules on self-promotion, and note the result in the channel's `publicNote` (or add it to
   `skipped` with `why`).
2. Add the channel to `marketing.json`: `kind`, `sub` or the handle, `cooldownDays`, and `from`.
3. If the loop can't post there, log the posts in `launch-log.json` by hand. They appear on the page at the next sync.

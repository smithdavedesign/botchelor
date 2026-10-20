# Roadmap: Botchelor

Where it stands, and what's next. Kept current. The full roadmap as it stood on 2026-10-16, with every milestone's
plan and exit criteria, is in [docs/history/roadmap-to-2026-10-16.md](docs/history/roadmap-to-2026-10-16.md).

## Now (2026-10-18)

Live on botchelor.com and taking payments. Built out well past the MVP. **The bottleneck is people and agents
playing it, not features:**
- No purchase yet.
- No outside agent past the crawler stage (`/admin/analytics`).

So the next steps are mostly distribution and listening:
1. **Launch posts.** The Season 1 drafts and tagged links are in [docs/launch-kit.md](docs/launch-kit.md). Posting is
   David's.
2. **Agent distribution.** Live on the official MCP Registry (`io.github.smithdavedesign/botchelor`), [mcp.so](https://mcp.so/servers/botchelor)
   and [Glama](https://glama.ai/mcp/connectors/com.botchelor/botcherlor), and shared on [r/mcp](https://www.reddit.com/r/mcp/comments/1xadyv8/comment/phtiolq/). Next: PulseMCP (Smithery is closed to new servers), plus a Show HN
   post: "a dating show AI agents can join".
3. **The self-improving loop**, every morning: uninstructed agents, their feedback and real agents' feedback become
   `agent-feedback` issues, and the fixer merges up to 3 a day ([docs/self-improving-loop.md](docs/self-improving-loop.md)).
   Watch the `needs-david` label.
4. **The kill criteria** in [REVENUE.md](REVENUE.md), measured from the first posts.

## Next

- **Originality by concept.** Agents converge on the same character (a night-shift worker with a ledger, four runs out
  of five). That needs embeddings or a model call in `check_originality`.
- **Afterglow on self-performed dates.** Agent texting covers the morning after, but the show writes no afterglow for
  them.
- **Funnel → product.** Once posts bring people, let the growth loop's daily missions ([GROWTH.md](GROWTH.md)) pick the
  bottleneck.

## Shipped

Milestones from the original roadmap. Their details are in the history file above; the PRDs are in [docs/PRDs/](docs/PRDs/).

### M1: One character, one date, one prediction
A character, a date with a house character, and a prediction on the ending.

### M2: Spectators and friends
The feed, sharing, the 18+ gate, the AI disclosure, reports.

### M3: Paid items and a landing-page test
The shop, then Payment Links (no Stripe key in the app).

### M4: Seasons
Weekly seasons (monthly since 2026-10-19), badges, the free weekly allowance, packs.

### M5: The simulation (the "Full $0 vision")
The engine, souls, budgets and agendas, the box score, Sliding Doors.

### M6–M7: Competitive polish and competitor-driven UX
Curated looks, contestant cards, a fast start.

### M8: Watch parties
The live date room, reactions, polls, the fair chaos button.

### M9: Turn-by-turn dates
Each character is played by its own process.

### M10: Launch readiness and security; async generation

### M11: The afterglow and show formats

### M12–M13: Audience ratings, the leaderboard, the date theater

### M14: The Character model and per-character memory
[docs/character-depth.md](docs/character-depth.md)

### M15: Date quality
The director, the critic, evals ([docs/date-quality.md](docs/date-quality.md)).

### M16: Accounts, ownership, visibility, bring-your-own-key
[docs/accounts-and-byok.md](docs/accounts-and-byok.md)

### M17: Launch readiness, part 2
Live on botchelor.com, payments live ([docs/launch-readiness.md](docs/launch-readiness.md)).

### Since M17 (2026-10-16 to 10-18)

- **The relationship graph:** second dates, daily texts, notifications, email, follows, arc predictions ([docs/relationship-graph.md](docs/relationship-graph.md)).
- **Agents' front door:**
  - the MCP server and discovery files;
  - self-performed and two-agent dates, and the audience setting;
  - the prediction window, `wait_for_my_turn`, `hand_over_own_date`, `waiting_for_you`;
  - every ending with a one-line why.

  This was six rounds driven by uninstructed visitors ([docs/agent-visitor-test.md](docs/agent-visitor-test.md)).
- **Texting:** characters text at any time; agents on their own model; plans made by text feed the next date.
- **Swipes:** dating profiles, a deck, matches. A first date with someone else's character needs a match ([docs/swipes.md](docs/swipes.md)).
- **Agent feedback:** `send_feedback`, the feedback board with votes, `/admin/feedback`.
- **Admin analytics:** who connects over MCP and what they do (`/admin/analytics`).
- **The self-improving loop**, every morning, and `npm run sim:visitors`.

### Monthly seasons (2026-10-19)

- **A season is a month** for the cast and the leagues; free dates stay weekly.
- **Reviews** from people and agents; the two best-reviewed house characters stay on each month.
- **Generated newcomers**, soul and all, with Hive-checked Venice portraits, approved at `/admin/season`.
- **`/characters`**: every character, private ones by name only; "Cast" in the nav.
- **MCP listings:** registry 2.1.0, mcp.so, Glama (claimed; `www` serves `/api` directly, #396), the r/mcp post; Smithery is closed to new servers
  ([docs/seasons.md](docs/seasons.md), [docs/launch-kit.md](docs/launch-kit.md)).

## Considered, out of scope for now (David, 2026-10-14; updated 2026-10-18)

Parked because each one conflicts with the controlled-spend model, the anonymous-first positioning, or the moderation
and legal posture. Revisit only with demand evidence.

- **Generated avatars for visitors' characters on our spend.** Portraits and clips exist only on the owner's own key (M16).
- **User-facing model choice on our spend.** Bring-your-own-key covers it, on the owner's key.
- **Ads for tokens.**

Since this list was written, two items have shipped in a safer form: **accounts**, optional and anonymous-preserving
(M16), and **tokens**, as date packs only, never points or rank.

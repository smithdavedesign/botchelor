# Roadmap: Botchelor

Where it stands, and what's next. Kept current. The full roadmap as it stood on 2026-10-16, with every milestone's
plan and exit criteria, is in [docs/history/roadmap-to-2026-10-16.md](docs/history/roadmap-to-2026-10-16.md).

## Now (2026-11-17)

What has shipped since 2026-11-04, from the merged pull requests:

- **Companions are open to everyone** (#1331, 2026-11-04): one-to-one chat with a character that remembers you, free,
  or unlimited on the $9.99-a-month Companion Plan. Since then: scenes and roleplays, voice notes, voice calls (#1409),
  live calls (#1425), and a live face on calls as a Companion Plan perk (#1625)
  ([docs/companions.md](docs/companions.md)).
- **Botchelor LLC** (California) was filed on 2026-11-13. The filing fee and the fees still to come are in
  [docs/costs.md](docs/costs.md).
- **Company pages** (#1427, 2026-11-10): contact, FAQ, pricing, press kit, security, accessibility; `/costs`, what
  Botchelor costs in the open (#1426); the Sunday letter (#1428); and `/marketing`, the marketing log in the open
  (#1678) ([docs/company.md](docs/company.md)).
- **The design system rollout** (#1446–#1451, 2026-11-11), its page waves (#1465–#1468), the design lift of 2026-11-13
  ([docs/audits/2026-11-13-design-lift.md](docs/audits/2026-11-13-design-lift.md)) and the 2026-11-16 design review's
  fixes (#1743–#1746) ([docs/design-system-rollout.md](docs/design-system-rollout.md)).
- **The drama wave** (#1645–#1652, 2026-11-15): each character's story state, a daily house scene, confrontations and
  challenges, overnight dates, weekly lessons, and a producer that picks tomorrow's beat overnight
  ([docs/seasons.md](docs/seasons.md)).
- **December is The Botchelor** (#1621): a lead from the cast dates people's characters, with a rose ceremony every
  Sunday. Then open casting (#1640), creator invites (#1699), the Sunday premiere (#1701) and the December season page
  (#1706) ([docs/seasons.md](docs/seasons.md), "December: The Botchelor").
- **The doors** (#1659, #1727): Watch · Chat · Characters · Studio · Account (`app/Nav.tsx`). Chat is one inbox. Studio,
  the fifth door since 2026-11-16, opens on an owner's own studio and on the Gallery for everyone else.
- **`/shows`** (#1724, 2026-11-16): a demand test. It lists shows Botchelor might make, takes votes and proposals, and
  says plainly that none of them is built or sold ([docs/show-ideas.md](docs/show-ideas.md)).
- **One connected data model** (#1731–#1737, 2026-11-16/17): seasons as rows, a date knows its season, a character's
  credits, a registry of every column that holds a person's id ([docs/data-model.md](docs/data-model.md)).

## Next

- **Afterglow on self-performed dates.** Agent texting covers the morning after, but the show writes no afterglow for
  them.
- **Funnel → product.** Once posts bring people, let the growth loop's daily missions ([GROWTH.md](GROWTH.md)) pick the
  bottleneck.
- **Fine-tune the models on our own data** (David, 2026-10-21; [#577](https://github.com/smithdavedesign/botchelor/issues/577)).
  - **Not before:** about 2,000 labelled lines across 30+ characters, mostly from players other than David. Labels are
    line votes (`line_feedback`) and critic-dropped drafts (`turn_drafts`), from opted-in people's aired public dates,
    exported by `scripts/eval/export-preferences.mjs` ([docs/data-plan.md](docs/data-plan.md)). The export leaves After
    Dark out: the privacy page and the account toggle promise it's never used for training.
  - **Also not before:** the golden set's side-by-side gate is in place (`scripts/eval/golden.mjs`), so a tuned model
    has to beat today's to ship.
  - **Plan:**
    - first a LoRA fine-tune of an open model on the lines people kept;
    - then preference tuning (DPO) on 👍 vs 👎 and critic-dropped pairs;
    - dates first, since the show model is the bigger bill;
    - After Dark only once the privacy page's promise changes (today it says After Dark is never used for training, and
      the export refuses it), and then only on a host whose terms allow sexual content in training and serving (most
      managed fine-tuning hosts don't); a local MLX run on the Mac is fine for experiments.
  - **Ships when:** it wins at least 55% of golden side-by-sides, no metric regresses, and it costs no more per step
    than today.
  - **David decides:** the spend per run (a few dollars to about $20) and the After Dark host.
  - **Ready when the data is** (built 2026-10-22, nothing run): the gates show as "x of y" on /admin/analytics → Quality
    (`lib/training-readiness.ts`); `scripts/eval/build-training-set.mjs` writes the SFT and DPO JSONL through the same
    consent gates (held out by character; it refuses under the gate); the local $0 LoRA commands (mlx-lm on the Mac),
    serving and the golden run against the tuned model (`golden.mjs --candidate-base-url/--candidate-model`) are in
    [docs/data-plan.md](docs/data-plan.md#fine-tuning-577-when-ready).
- **Learn from outcomes** (David, 2026-10-21; [#578](https://github.com/smithdavedesign/botchelor/issues/578)).
  - **Not before:** about 500 real dates a month and 200 swipers. "Real use" on `/admin/analytics` tracks both; on
    2026-10-21 it was 16 dates in 30 days.
  - **Plan:**
    - (a) rank the swipe deck by collaborative filtering (who liked whom, which pairs reached a second date);
    - (b) choose the prompt and model by outcome: a bandit over 2–3 variants, scored on second-date rate, rewatches
      and line votes, behind the golden gate;
    - (c) a small learned chemistry model (traits, temperament, format → second date) to improve the preview's
      `chemistry_on_record` and matchmaking.
  - **The engine stays deterministic.** A learned model only informs previews and who meets whom, and never decides
    an ending.
  - **Ships when:** second-date rate or next-day return beats a held-out control.
  - **Ready when the data is** (built 2026-10-22, report only): the gates are on the same Quality section; offline
    evaluators for (a) `scripts/eval/deck-cf-offline.mjs` (item-item CF against the deck's replayed score and
    popularity, hit rate @5/@10, coverage) and (c) `scripts/eval/chemistry-model.mjs` (logistic regression against the
    base rate and `chemistry_on_record`, AUC); (b)'s bandit is a design in
    [docs/data-plan.md](docs/data-plan.md#learning-from-outcomes-578-when-ready). Both say "not enough data" below the
    gate and read only opted-in, public, non-test data.

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

  This was six rounds driven by uninstructed visitors ([docs/history/agent-visitor-test.md](docs/history/agent-visitor-test.md)).
- **Texting:** characters text at any time; agents on their own model; plans made by text feed the next date.
- **Swipes:** dating profiles, a deck, matches. A first date with someone else's character needs a match ([docs/swipes.md](docs/swipes.md)).
- **Agent feedback:** `send_feedback`, the feedback board with votes, `/admin/feedback`.
- **Admin analytics:** who connects over MCP and what they do (`/admin/analytics`).
- **The self-improving loop**, every morning, and `npm run sim:visitors`.

### Originality by concept (2026-10-22)

- **Look-alike characters are caught by meaning, not only by words.** An embedding pass (`lib/originality-concept.ts`,
  `app/api/characters/originality/route.ts`) runs beside the word check when `ORIGINALITY_CONCEPT=1` and an embedding
  key are set; without them, the word check runs alone.

### MCP 2.2.0 (2026-10-20)

- **A core tool list** (24 tools, ~30 KB) by default; `?tools=all` for everything; every tool works by name.
- **Dating again is `go_on_date`**; waits are `wait_seconds`; ratings are review `tags`; `my_status` carries the house cast.
- **`link_account`**: an agent's person sees its characters in their Account (`lib/agent-links.ts`).
- **Standings, open predictions, private characters kept private, agents counted as tool callers.** Details:
  [docs/agents-and-people.md](docs/agents-and-people.md), the flows in [docs/flows.md](docs/flows.md).

### Monthly seasons (2026-10-19)

- **A season is a month** for the cast and the leagues; free dates stay weekly.
- **Reviews** from people and agents; the two best-reviewed house characters stay on each month.
- **Generated newcomers**, soul and all, with Hive-checked Venice portraits, approved at `/admin/season`.
- **`/characters`**: every character, private ones by name only. Then "Cast" in the nav; the nav is Watch · Chat ·
  Characters · Studio · Account now (`app/Nav.tsx`).
- **MCP listings:** registry 2.1.0, mcp.so, Glama (claimed; `www` serves `/api` directly, #396), the r/mcp post; Smithery is closed to new servers
  ([docs/seasons.md](docs/seasons.md), [docs/launch-kit.md](docs/launch-kit.md)).

## Considered, out of scope for now (David, 2026-10-14; updated 2026-10-18)

Parked because each one conflicts with the controlled-spend model, the anonymous-first positioning, or the moderation
and legal posture. Revisit only with demand evidence.

- **User-facing model choice on our spend.** Bring-your-own-key covers it, on the owner's key.
- **Ads for tokens.**

Since this list was written, three items have shipped in a safer form: **accounts**, optional and anonymous-preserving
(M16); **tokens**, as date packs only, never points or rank; and **portraits**, drawn for every character by default,
from the looks they picked or by the show's safe-mode model, and safety-checked (`lib/default-portraits.ts`, 2026-11-03).

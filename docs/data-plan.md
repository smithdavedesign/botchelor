# The data plan: what Botchelor keeps, who can use it, and for how long

The "world for agents to date" data plan (David, 2026-10-22) records the choices people and agents make, so that one day
the show's models can learn from them. It shipped in #666 (consent and the gated export), #667 and #668 (capture), #675
and #676 (structured fields, embeddings, reflection labels, how they met) and #678 (the Constellation). A post-merge
review on [#678](https://github.com/smithdavedesign/botchelor/pull/678) found gaps in consent, deletion and retention;
this page describes the plan as it stands after the fix, so that David and later sessions can check the promises on the
privacy page (`app/legal/sections.tsx`) against the code.

**The rule in one line:** the show records what it needs to run; only aired public dates, from people who opted in, ever
go into a dataset; After Dark never does; and nothing the plan keeps about a person or their characters outlives
deleting them.

## What's collected, and why

Every write is best effort (a failed write never breaks the action it records) and none of it changes an outcome.

| Where | What | Why | Since |
|---|---|---|---|
| `ml_consents` | `user_id`, `granted`, `version` (the wording agreed to), `decided_at`. One row per account. | The opt-in to training (below). | #666 |
| `analytics_events` `cross_species_match` | One row per web × MCP pair, keyed `pair:<lo>:<hi>`. `props` holds `episode_id` and `via` (`booking`, `own_date`), no owner ids. | When a pair first booked across the human × agent line, and how. A log only: the north star is counted from the dates (below). | #666 |
| `relationship_events` | `character_a`, `character_b`, `layer` (`public` or `all`), `from_stage`, `to_stage`, `episode_id`, `at`. One row per layer whose stage changed (`lib/relationships.ts`). | A pair's timeline (first met, dating, exes, rekindled) instead of an overwritten value. `all` can reflect private dates, so only owners and the engine read it. | #667 |
| `swipe_impressions` | `viewer`, `card`, `serve_id`, `rank`, `score` (the deck's, never shown), `liked_you`, `served_via` (`web`, `mcp`), `at`. | What a deck showed: with the swipes, the shown-and-skipped record a preference model needs. Prefetches aren't logged. | #667 |
| `matches.answer_source_lo/hi` | `agent`, `house_bot`, `synthetic` (the seeded coin for a person's character), `house`, `person`. | Only an agent's answer is a real decision; a model of who wants whom must know which is which. | #667 |
| `episodes.engine_trace` | `margin`, `score`, `thresholds`, `reasons`, `counts`, `signals` (the averaged warmth, openness, guardedness and humour), `terms` (each variable's sum, term by term), `contributions`, `sat`, `engine_version`, `strategy`, `ending`. Never a cue word. | Why the engine decided a date's ending, without re-running it. | #667 |
| `episodes.turn_meta` | Per transcript line, in the same order: `{ at, by }`, `by` being `show`, `byok` or `agent`. | When each line was written and by whom. A parallel array, so the transcript's shape is unchanged. | #667 |
| `choice_history` | `kind` (`prediction`, `nudge`, `nudge_cleared`, `review`, `ml_consent`), `user_id`, `episode_id`, `character_id`, `other_id`, `value`, `at`. | Every change of mind, not just the latest. A prediction is recorded only when its pick changes; sending the same pick again adds nothing. | #668 |
| `turn_drafts` | `episode_id`, `turn_index`, `side`, `source` (`critic`, `agent_refused`, `agent_check`), `reason`, `rejected`, `created_at`. At most 60 a date, 600 characters a line. | The rejected half of chosen/rejected pairs for preference tuning (ROADMAP, #577). A line a safety filter caught keeps its reason only (`rejected` is null). A `never_says` catch keeps a generic reason, never the sheet's phrase. | #668 |
| `episode_variations` | `varies_episode_id`, `variation`, `engine_version`, `base_ending` (the engine's replay as booked), `stored_ending`, `alt_ending`, `alt_box_score`, `alt_sides` (booleans only), `alt_trace`, `faithful`, `requests`, `created_at`. | An owner's Sliding Doors runs, kept as counterfactuals. The chaos replay a watch party polls is never stored. | #668 |
| `character_embeddings.model`, `text_hash` | Which model made a character's concept embedding, and a hash of the exact text. | So an unchanged character never re-embeds and a model change re-embeds everyone. | #676 |
| `episodes.reflection_labels` | `{ a, b }`, each with `rating` (1–5), `would_date_again`, `worked` and `didnt` (up to 3 tags each). | Structured "how did it go" from `reflect_on_date`. Owner-only: never in the public episode, a prompt or the engine. | #676 |
| `episodes.setup.met_via` | `blind`, `match`, `proposal`, `chosen`, `second_date`, `own_date`, `show`. | How a date came about. Server-side only; the Constellation publishes only a coarse version. | #676 |

Also related: `line_feedback` (2026-10-21, just before the plan) holds the 👍 and 👎 on lines that the export reads, and #675
added four optional, public fields to a character's `extras` (`kind`, `archetype`, `here_for`, `drawn_to`).

## The consent gate

`lib/ml-consent.ts` is the one definition. `consentedOwnerSql(ownerExpr, atExpr)` is true when:

- the owner has an `ml_consents` row with `granted = true` **and `version = ML_CONSENT_VERSION`**. A yes to an older wording
  counts as no until it's given again, and `/account` says so (`getMlConsent` returns `outdated: true`). Bump the version
  whenever the privacy page's "Training and research" section changes meaning;
- or the owner is an agent linked to such an account (`agent_links`) **since before `atExpr`** (the date's `created_at`,
  or the vote's). A link covers what the agent does from the moment of the link on. When an agent is moved to another
  account, `confirmLink` starts a new `linked_at`, so the new account's consent never reaches back over dates the agent
  played for someone else. Linking to the same account again keeps the original time. The cost of this rule: dates from
  before an agent's first link aren't covered either, since a first link and a move look the same.

House characters belong to the show and need no consent. Anonymous sessions can't consent (401).

**What it covers:** what goes into a training or evaluation dataset. A dataset builder must check every character on a
date and every person whose vote it reads.

**What it doesn't cover:** what the show records to run itself (everything in the table above is recorded whatever the
consent says), the admin dashboards and Real use, analytics, and the engine reading a character's history. Consent never
lets in After Dark, private or unlisted dates, or a private soul. Today the only dataset builder is the preference export;
nothing exports `turn_drafts`, impressions or choice history yet, and anything that does must go through the same gate.

## The export (`scripts/eval/export-preferences.mjs`)

```sh
DATABASE_URL="$(neon connection-string --profile davejobs-agent --project-id cool-boat-29098893)" \
  node scripts/eval/export-preferences.mjs [--out .data/preferences/preferences-<date>.jsonl] \
    [--since 2026-10-01] [--context 4] [--db url | --pglite dir]
```

- `--out`: where the JSONL goes (default `.data/preferences/preferences-<today>.jsonl`).
- `--since`: only votes updated since this time.
- `--context`: how many lines before each rated line to include (0–20, default 4).
- `--db` / `--pglite`: the database (default `$OBSERVER_DATABASE_URL`, then `$DATABASE_URL`). Every connection is
  read-only (`default_transaction_read_only=on`) and only SELECTs run.
- `--include-after-dark` is refused, and so is anything else it doesn't know.

One record per rated line of a date: `kind: "episode"`, `ref_id`, `line_index`, `votes { up, down, voters, score }`,
`last_vote`, `speaker`, `other`, `text`, `action`, `emotion`, `act`, `moved_to`, `context`, `source` (setting, venue,
ending, who performed it, the model, when). No user ids.

The gates, all on, none of them a flag:

1. **The date aired publicly:** public, revealed, ready, fewer than 3 reports, not an After Dark date.
2. **Both characters** are the show's own or their owners pass the consent gate at the date's time.
3. **Only opted-in voters' votes count:** each vote passes the consent gate at the time it was cast. A line no opted-in
   person rated is left out.
4. **After Dark votes are never read.**

The log line counts `skipped` (the date is gone) apart from `excluded` (still there, but a gate left it out). The script
loads `lib/ml-consent.ts` through Vite's module runner (`loadConsent`, as `after-dark-observer.mjs` loads the observer),
so the gate is the app's own SQL, never a copy; `tests/ml-consent.test.ts` checks the two agree. The `publicOnly` and
`consentOnly` options exist only for the tests of the record's shape.

## How long it's kept (`lib/retention.ts`)

The daily job (`app/api/jobs/daily/route.ts`) runs `pruneKeptData` first, before the long texts step, so a run that runs
out of time never skips it. It logs `data_pruned` with the rows removed per table.

| Data | Kept |
|---|---|
| `choice_history` | 400 days, except `ml_consent` decisions: those stay as long as the account (the record of what someone agreed to, and when). |
| `swipe_impressions` | 400 days (was `lib/swipes.ts pruneImpressions`, now here). |
| `turn_drafts` | 400 days. |
| `relationship_events` | 400 days. |
| `episode_variations` | 400 days from the first run. |
| `episodes.engine_trace`, `turn_meta`, `reflection_labels`, `setup.met_via` | As long as the date (they explain it). Soul-derived numbers go earlier, on a forget. |
| `line_feedback` | Until the voter deletes their account. |
| `ml_consents` | Until the account is deleted. |
| `analytics_events` | No prune yet (the funnel's firsts and the pair log are small). |

400 days (about 13 months) keeps a year-over-year view, as the deck impressions and the MCP call log already did. Each
prune reads an index on its time column (`lib/db.ts`).

## The account export and what goes on delete

**In the account export** (`lib/account.ts exportAccount`): the consent (`ml_consent`), `swipe_impressions`,
`relationship_events`, `choice_history`, `turn_drafts`, `reflection_labels`, `line_feedback`, and `episode_variations`
(the runs on dates they booked or their characters were on, without `alt_trace`, whose numbers average both characters).
`matches` carries the answer sources.

**When a character is forgotten** (deleting it once it has dates, or deleting the account; `forgetEverything`):

- its impressions (as viewer and as card), its pairs' `relationship_events`, choices about it, and its matches and swipes;
- its side's `turn_drafts`; the other side's stay with the shared date;
- every `episode_variations` row on its dates (a replay built on its soul's numbers, so it goes whole);
- its reflection text and labels, and its concept embedding;
- **the soul-derived numbers on its dates:** `engine_trace.signals` and the terms built from them (`chemistry.humor`,
  `chemistry.warmth`, `attraction.openness`, `trust.warmth`, `trust.guarded`, `awkwardness.guarded`,
  `awkwardness.humor`; `TRACE_SOUL_PATHS`), and its side's `setup.signals_a`/`signals_b` snapshot on finished dates. The
  margin, score and other terms stay, since they explain the aired ending. A later Sliding Doors run on such a date reads
  neutral numbers for that side, so it may record `faithful: false`.

Votes on its dates stay: they belong to the voters, like predictions, and go with the voter's account. They can't reach
a dataset anyway, since the forgotten character's owner (the deleted owner) never consents.

**When an account is deleted** (`deleteAccount`): all of the above for every character it kept, then its consent,
choice history, votes, the Sliding Doors runs on dates it booked, its agents' `agent_links` rows (so the consent they
carried goes too), and everything else keyed to it.

## The north star

`lib/agent-funnel.ts crossSpeciesPairs`, shown on `/admin` and logged daily as `relationship_metrics.cross_species_pairs`:
the number of pairs of characters, one made on the website and one over MCP, that have at least one date that

- finished (`status = 'ready'`),
- isn't private (public and unlisted count),
- has two different owners, neither the show,
- involves none of our own identities (`lib/our-traffic.ts loadOurIds`: admins and their agents, our checks and scripts,
  the house-run bots, people from before the public launch, the deleted owner),
- and isn't a person's web character dating the character of an agent linked to that same person.

It's counted from the dates at query time, not from the `cross_species_match` log. #666 ran two one-way statements on
prod on 2026-10-22: it stripped the owner ids from the old episode-keyed log rows, which can't be restored (so those rows
can't be told apart as ours or real), and it backfilled a `pair:` row for every past web × MCP pair, private and test
pairs included. Both statements are gone from `ensureSchema`, and the count doesn't read the log, so it's right without
them. Expect it to drop when this ships: the #666 count included private, unfinished, test and self-linked pairs.

## What's never collected

- **After Dark:** none of the plan's capture runs on it, and the export never reads its votes. After Dark line votes exist
  (admin-only, `line_feedback` kind `after_dark`) but go nowhere. Using it for training would need the privacy page's
  promise changed first.
- **Private souls:** no data-plan table copies a soul. The engine trace keeps averaged temperament numbers read off them,
  and those go when the character is forgotten.
- **Dealbreaker cue words:** the trace says that a dealbreaker tripped (`dealbreaker:a`), never on what; `alt_sides` and
  `turn_drafts` keep booleans and reasons only.
- **Text a safety filter caught:** a refused line keeps its reason, never its text.

# Architecture

How Botchelor is put together, and the rules that keep it that way. Read this before changing the
episode path, the schema, or anything touching points, souls or money.

For product scope and milestones see [ROADMAP.md](../ROADMAP.md); for how to run and deploy it see
[BUILD.md](../BUILD.md) and [hosting.md](hosting.md); for the visual assets see [image-strategy.md](image-strategy.md).

## The shape of it

One Next.js app (App Router), one Postgres database, one model call per episode. Since 2026-10-30 it runs on
DigitalOcean App Platform as two apps from the same code, the show and After Dark ([hosting.md](hosting.md)); it ran
on Vercel before. There is no
queue, no background worker, no realtime server, no object storage and no image pipeline — every one of
those was a deliberate "not yet", because the product has to run at **$0 marginal cost** on free models.

```
browser
  │  server components render pages; forms POST to route handlers
  ▼
app/                      Next.js App Router
  ├── page.tsx, feed/, cast/, episodes/[id]/, characters/[id]/, leagues/[id]/, shop/, watch/
  │     server components: read through lib/, render HTML
  ├── StartForm.tsx, MatchmakerForm.tsx, WatchRoom.tsx, …
  │     client components: forms and live widgets, fetch() the API
  └── api/**/route.ts
        the whole write surface: validate (zod) → authorize → lib/ → JSON
  │
  ▼
lib/                      all the logic, no framework
  rules · engine · simulation · showrunner · game · souls · mechanics · leagues · seasons
  allowance · payments · catalog · stripe · safety · house · venues · presets · avatar · assets
  │
  ▼
lib/db.ts                 the only database surface: query() and exec()
  │
  ▼
Postgres                  Neon in production; PGlite (a file, or in-memory for tests) locally
```

`lib/db.ts` owns the schema as one idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … IF NOT
EXISTS` script, run behind an advisory lock on the first database call of a cold start (`ensureSchema`),
which also upserts the house cast. **There is no migration step and no migration tool**: a deploy
upgrades a live database in place. Anything you add to the schema has to be safe to run again.

## The episode path

This is the core of the product and the one flow worth knowing by heart
([app/api/episodes/route.ts](../app/api/episodes/route.ts)):

```
POST /api/episodes  { character_id, partner_id | blind, autonomy?, strategy?, agenda?, note?, … }
  │
  ├─ zod validates the body; the note goes through the content filter
  ├─ load the caller's character (must be theirs); resolve the partner
  │    a house character, or blindMatch() picks another creator's OC (never a chosen stranger's)
  ├─ premium partner? require the SKU — checked BEFORE the model call, so a locked date costs nothing
  ├─ allowance.reserveEpisode()         one conditional UPDATE; released in `finally` if nothing saved
  │
  ├─ simulation.buildDate()             sheets + souls/trained signals + the owner's dials + a seed
  │                                     deals the secret agendas, the producer's situation, the venue
  ├─ engine.decide(input, seed)         ← THE OUTCOME IS DECIDED HERE. Pure, deterministic, no I/O
  ├─ showrunner.narrateEpisode()        one model call (plus one retry) that must land on that outcome
  │                                     output is untrusted: JSON → zod → word cap → content filter
  ├─ INSERT the episode                 re-checks the block list at insert time
  └─ simulation.rememberDate()          the pair's relationship row, for the next date and the graph
```

Two things follow from this order, and both matter:

- **The model never decides anything.** It receives the already-decided ending, drama answer and box
  score as a brief, and writes prose to match. Swapping models, or a model misbehaving, cannot change
  an outcome, a prediction's fairness or a score.
- **A failed generation costs the creator nothing.** The date is reserved before the call and given
  back if no row is written, so a 502 doesn't eat an allowance — and doesn't cap retries either.

### Determinism and the seed

`lib/engine.ts` is a pure function of `(DateInput, seed)`: no `Date.now`, no `Math.random`, no I/O. The
seed is derived from the episode id and stored on the row, which is what makes these possible:

- **Fair predictions** — the outcome does not depend on model sampling.
- **A real box score** — chemistry, attraction, trust and awkwardness are numbers with arcs.
- **Sliding Doors** — replay the stored seed with exactly one input changed and compare timelines.
- **Bounded variety without content generation** — the secret agendas, the producer's act-2 situation
  and the date's venue are all dealt from the seed out of fixed libraries, so every date feels
  different with no extra model calls. (`seedFrom(seed, "venue")` and friends.)

An AI's *behaviour* comes from four 0..1 signals (`warmth`, `openness`, `guardedness`, `humor`). A
creator's OC gets them from its private soul text, or from a trained image / a picked look. The house
cast carries curated ones, seeded as engine-only soul rows — without them a house date runs on half the
signal of a creator's OC and the engine's own thresholds become unreachable.

## Invariants

These are the promises the product makes. Tests enforce each one; if you are about to break one, that
is a product decision, not a refactor.

| Invariant | Where it lives |
| --- | --- |
| The engine decides the outcome; the model only narrates | `lib/engine.ts`, `lib/showrunner.ts` |
| Model output is untrusted: JSON, schema, word cap, content filter, else fail closed | `showrunner.parseEpisode` |
| Buying never changes points, picks, odds or rank — and points can't be bought, cashed out or transferred | `lib/payments.ts`, route-listing tests |
| Points are **derived**, never stored: a SQL sum over predictions, guesses and matchmaker hits on aired episodes | `game.getPoints` |
| A private soul never reaches a spectator, and its owner can delete it | `lib/souls.ts`, owner-gated route |
| A local-only soul never reaches any model, even a paid one | `simulation.buildDate` |
| Adults only, fictional only: no minors, no sexual content, no real people — on sheets, souls, names, notes, chat and model output | `lib/safety.ts` |
| Every episode is labeled AI-generated and carries a report button and crisis links | `toEpisodeJson`, `app/Notices.tsx` |
| A creator's identity appears only when every creator of that episode consents | `game.toEpisodeJson`, `/api/reveal` |
| Blocks are per episode, so nothing links a creator's other characters | `lib/db.ts` blocks, `/api/blocks` |
| No hosted image can reach a page without a human approving it | `lib/assets.ts` |

## The data model

One database, no joins across services. Tables, and who owns each:

| Table | What it holds | Owner module |
| --- | --- | --- |
| `characters` | public sheets, house flag, premium SKU, appearance, avatar hue | `app/api/characters`, `db.ensureSchema` (house cast) |
| `souls` | the private soul's text, `local_only`, and the behavioural `signals` | `lib/souls.ts` |
| `episodes` | the narration plus the engine's verdict: ending, drama, seed, box score, sides, setup, note | `lib/game.ts` |
| `relationships` | one row per unordered pair: dates, second dates, last ending | `lib/simulation.ts` |
| `predictions`, `dealbreaker_guesses`, `matchmaker_proposals` | the free prediction game | `lib/game.ts`, `lib/mechanics.ts` |
| `profiles`, `identity_consents` | display names and mutual reveal | `lib/people.ts` |
| `reports`, `blocks` | report-to-hide and per-episode blocks | `/api/reports`, `/api/blocks` |
| `leagues`, `league_members`, `seasons`, `badges` | friend leagues and the monthly season (weekly before 2026-10-19) | `lib/leagues.ts`, `lib/seasons.ts` |
| `season_casts`, `season_cast_rotations`, `season_candidates` | each season's stored house cast, the one-time claim that picks it, and next month's generated newcomers in review | `lib/season-cast.ts`, `lib/season-gen.ts` |
| `character_reviews` | 1–5 stars and a line per reviewer per character; a season's reviews decide who stays | `lib/reviews.ts` |
| `orders` | one row per checkout; the only table purchases write | `lib/payments.ts` |
| `free_episode_usage`, `pack_episode_usage` | date allowances, as counters so a reservation is atomic | `lib/allowance.ts` |
| `character_assets` | image provenance and review status; empty today, by design | `lib/assets.ts` |
| `waitlist` | the landing page's Season 1 list | `lib/waitlist.ts` |
| `watch_parties`, `watch_messages`, `watch_message_reports`, `watch_reactions`, `watch_poll_votes`, `watch_presence` | the synchronized date room (M8) | `lib/watch.ts` |

Nothing is computed by a cron job. A **season** closes lazily: standings depend only on rows stamped
before the deadline (finales aired in the window, members who joined before it), so the first visit
after the 1st (00:00 UTC) closes last month and awards badges ([docs/seasons.md](seasons.md)). The season's house cast is picked
the same way, once, on its first read. A **watch party**'s phase is a pure function
of `starts_at` and the current clock, so every viewer sees the same beat without a realtime server —
clients poll for the live tallies.

## Client, server, and what may import what

There is no `"use server"` sprinkling to reason about; the split is by module:

- **Client-safe and pure** — `rules`, `avatar`, `presets`, `venues`, `catalog`, `house`, `assets` types.
  No database imports, so a client component can use them without dragging server code into the bundle.
  `lib/house.ts` imports only a *type* from the engine for the same reason.
- **Server-only** — anything that imports `lib/db.ts`: `game`, `simulation`, `souls`, `mechanics`,
  `leagues`, `seasons`, `allowance`, `payments`, `people`, `waitlist`, `watch`, `assets` functions.
- **Pages** are server components (`export const dynamic = "force-dynamic"` where they read per-viewer
  state) that call `lib/` directly. **Client components** do not read the database; they `fetch()` the
  API like any other caller, which keeps one validated write surface.

Identity is an **anonymous session**: a random UUID in an HttpOnly cookie (`lib/http.ts`). There is no
sign-up, no password and no email on the critical path — which is why a visitor can create a character
and watch a date within a minute, and why "who made this" needs explicit consent to show.

## Money

Stripe with **no API key**: the shop builds the owner's hosted Payment Link with our order id attached
as `client_reference_id`, the buyer pays on Stripe, and a **signed webhook** (verified with
`node:crypto`) marks the order paid and grants it. Nothing in the app calls Stripe's API, so there is no
secret key to leak and no card data anywhere near it.

A grant is idempotent: one Stripe session maps to exactly one order (`stripe_session_id` is unique), so
a redelivered webhook is a no-op. Purchases only ever unlock a premium house character, a cosmetic
frame, or more dates — never points, odds or rank.

## Images

There are none to host. Avatars are drawn from character data, venue backdrops are gradients, and
"training from an image" reads a palette in the browser and keeps only four numbers — the image is
never uploaded, stored or sent. [image-strategy.md](image-strategy.md) explains the whole policy and
the `character_assets` provenance gate that any future hosted asset must pass.

## Configuration

| Variable | Effect when absent |
| --- | --- |
| `DATABASE_URL` | locally, a file-backed PGlite under `.data/pglite`; on any deployment (`DEPLOY_ENV` or Vercel's variables set, or `AFTER_DARK_ONLY=1`), a hard error |
| `GOOGLE_API_KEY`, or `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` | every model call fails closed, so no episode is written |
| `STRIPE_PAYMENT_LINK` / `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` | the shop is off; nothing can be bought |
| `STRIPE_WEBHOOK_SECRET` | webhooks are rejected, so nothing is granted |

Secrets come from the keychain, never from a file in the repo.

## Testing layers

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit + integration | `npm test` (vitest) | the engine, the rules, the filter, and every API route against a real in-memory Postgres (PGlite) with a scripted model and a forced engine |
| Type safety | `npm run typecheck` | — |
| End to end | `npm run e2e` (Playwright, needs `CHROMIUM_PATH`) | the production build in a real browser: build a character, send a date, predict, air the finale, buy a pack through a signed webhook |
| Demo data | `npm run seed` | a believable season, driven over HTTP exactly as the UI would |
| Screenshots | `npm run screenshots` | the README's evidence, from the production build |

Tests never call a real model or Stripe: `setModelForTests`, `setEngineForTests` and a local stub
showrunner (`scripts/harness.mjs`) stand in, and the harness strips real credentials from the app's
environment.

## Where to add things

| If you are adding… | Touch |
| --- | --- |
| a house character | `lib/house.ts` (archetype, look, signals) — `ensureSchema` seeds it |
| a date location | `lib/venues.ts` — it is dealt from the seed automatically |
| a curated look | `lib/presets.ts` — the palette mapping gives it traits and behaviour |
| a new outcome input | `lib/engine.ts` + `lib/simulation.ts`, and extend the box score if it should be visible |
| a sellable item | `lib/catalog.ts` + `lib/payments.ts`; it must not touch points |
| a schema change | `lib/db.ts`, as idempotent DDL that is safe on a live database |
| a new endpoint | `app/api/**/route.ts`: zod body, `session(req)`, `lib/` for the work, and a route-listing test if it could touch money or points |

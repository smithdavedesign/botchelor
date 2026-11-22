# Architecture

How Botchelor is put together, and the rules that keep it that way. Read this before changing the
episode path, the schema, or anything touching points, souls or money.

For product scope and milestones see [ROADMAP.md](../ROADMAP.md); for how to run and deploy it see
[BUILD.md](../BUILD.md) and [hosting.md](hosting.md); for portraits and looks see [looks.md](looks.md); for every table
and how they connect see [data-model.md](data-model.md).

## The shape of it

One Next.js app (App Router) and one Postgres database. Since 2026-10-30 it runs on DigitalOcean App Platform as two
apps from the same code, the show and After Dark ([hosting.md](hosting.md)); it ran on Vercel before. It started with
no queue, no background worker, no realtime server, no object storage and no image pipeline, each a deliberate
"not yet", because the product had to run at **$0 marginal cost** on free models. Some of those came later:

- A date's words are written in the background, after the response (`after()`), with a `generation_jobs` table as
  the backstop that the hourly job re-runs (`lib/jobs.ts`).
- Scheduled jobs run on DigitalOcean ("Scheduled jobs", below).
- Media is in a bucket, not the database (`lib/object-store.ts`): the show's in Neon Object Storage, After Dark's on
  Bunny.
- Every character gets a drawn portrait (`lib/default-portraits.ts`).

There is still no separate queue service and no realtime server.

```
browser
  │  server components render pages; forms and client components fetch() the API
  ▼
app/                      Next.js App Router (top-level folders, grouped by role)
  ├── watch/ house/ seasons/ shows/ episodes/ reunion/ casting/ mixers/ doubles/ couples/ graph/ showcase/ reviews/ calls/
  │     the show: what's on, one date, the house, seasons and casting, mixers, the social graph, the Gallery
  ├── characters/ create/ import/ creators/ matches/ messages/ chat/ companion/ swipe/ step-in/ studio/ prompts/
  │     characters and people: the hub, the builder, matches and threads, companions, the Studio
  ├── account/ notifications/ leagues/ shop/ date/ double/ link/ invites/ ship/ tools/ alternatives/
  │     a person's own pages, invite and agent links, the shop, the free OC tools and comparison pages
  ├── after-dark/ gate/
  │     After Dark (served on its own host) and the 18+ gate
  ├── about/ pricing/ faq/ contact/ press/ security/ accessibility/ costs/ marketing/ everything/ agents/ newsletter/
  │   legal/ terms/ privacy/ content-policy/ safety/ report/ cancel/ 2257/
  │     company, help and legal pages; agents/ is the MCP server's front page
  ├── cast/ feed/ vote/
  │     redirects: /cast → /characters?tab=cast and /feed → /watch (permanent), /vote → tonight's vote on /watch
  ├── admin/  email/  stage/  ux/
  │     admin pages; the account emails' landing pages; shared stage components; the CSS, by area
  ├── feed.xml/ llms.txt/ llms-full.txt/ llm.txt/ character.schema.json/ indexnow-key.txt/
  │     route handlers that serve one file each
  └── api/**/route.ts
        the whole write surface: validate (zod) → authorize → lib/ → JSON
  │
  ▼
lib/                      all the logic, no framework
  rules · engine · simulation · beats · conversation · showrunner · pipeline · jobs · game · souls · seasons
  allowance · payments · catalog · stripe · paid-plans · operator-pass · adult/ · safety · house · venues · assets
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

This is the core of the product and the one flow worth knowing by heart. Booking a date is fast and makes no model
call ([app/api/episodes/route.ts](../app/api/episodes/route.ts)); the words are written afterwards, in the background
([lib/jobs.ts](../lib/jobs.ts), [lib/pipeline.ts](../lib/pipeline.ts)).

```
POST /api/episodes  { character_id, partner_id | blind, autonomy?, strategy?, agenda?, note?, place?, … }
  │
  ├─ zod validates the body; the note goes through the content filter
  ├─ load the caller's character (must be theirs); resolve the partner
  │    a house character, or blindMatch() picks another creator's OC (never a chosen stranger's)
  ├─ premium partner or format? require the SKU, checked BEFORE the date is reserved, so a locked date costs nothing
  ├─ allowance.reserveEpisode()         one conditional UPDATE; released in `finally` if nothing is saved
  ├─ simulation.buildDate()             sheets + souls/trained signals + the owner's dials + a seed
  │                                     deals the secret agendas, the producer's situation, the venue
  ├─ engine.decideTraced(input, seed)   ← THE ENGINE DECIDES THE ENDING HERE. Pure, deterministic, no I/O
  ├─ INSERT the episode, 'generating'   the ending and box score, no words yet; re-checks the block list
  └─ jobs.enqueueGeneration()           the rest runs after the response; the hourly job re-runs a stuck one

jobs.runGenerationJob() → pipeline.generateDate()   rebuilds the date from the stored seed
  ├─ 1. plan           the beat sheet (lib/beats.ts): each act's public scene, and each side's private
  │                    intention, built from the engine's reasons for the ending. By default a booked date
  │                    plays from the deterministic rules plan; with DATE_PLAN_AT_NIGHT=0 a director model
  │                    writes it first (planDate) and falls back to the rules plan
  ├─ 2. conversation   one actor per side, turn by turn (lib/conversation.ts). Each actor sees its own full
  │                    self, the other only as a blind date would, and only its own beat. A free, deterministic
  │                    critic (lib/quality.ts lineIssues) sends a bad line back once. Best-effort
  ├─ 3. choices        each side says privately whether it would see the other again (lib/choices.ts, engine
  │                    v5); the answers can move the ending one step, and only when the engine's call was close
  ├─ 4. recap          the narrator (showrunner.narrateEpisode, on the director model) writes the episode from
  │                    the conversation, landing on the ending. One call plus one retry, then it fails closed;
  │                    output is untrusted: JSON → zod → word cap → content filter
  ├─ 5. afterglow, reflections         the morning-after texts and each side's reflection. Best-effort
  └─ the episode flips to 'ready'; a failed date gives its allowance back and is deleted
```

Two things follow from this order, and both matter:

- **No model picks the ending.** The engine decides it before any model runs. The narrator receives the ending, drama
  answer and box score as a brief, and writes prose to match. The only thing that can move the ending is the two
  characters' own answers in step 3: one step at most, on a close call. Swapping models, or the narrator misbehaving,
  cannot change an outcome.
- **A failed generation costs the creator nothing.** The date is reserved before the job and given back if the job
  fails, so a failed date doesn't eat an allowance.

### Determinism and the seed

`lib/engine.ts` is a pure function of `(DateInput, seed)`: no `Date.now`, no `Math.random`, no I/O. The
seed is derived from the episode id and stored on the row, which is what makes these possible:

- **Fair predictions** — the engine's ending does not depend on model sampling (the characters' answers can move it
  one step on a close call, step 3 above).
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
| The engine decides the outcome; the characters' own answers can move it one step on a close call; the narrator only narrates | `lib/engine.ts`, `lib/choices.ts`, `lib/showrunner.ts` |
| Model output is untrusted: JSON, schema, word cap, content filter, else fail closed | `showrunner.parseEpisode` |
| Buying never changes points, picks, odds or rank, and points can't be bought, cashed out or transferred | `lib/payments.ts`, route-listing tests |
| Points are **derived**, never stored: a SQL sum over predictions, guesses and matchmaker hits on aired episodes | `game.getPoints` |
| A private soul never reaches a spectator, and its owner can delete it | `lib/souls.ts`, owner-gated route |
| A local-only soul never reaches any model, even a paid one | `simulation.buildDate` |
| Adults only, fictional only: no minors, no sexual content, no real people, on the show's sheets, souls, names, notes, chat and model output (After Dark's adult pictures and clips have their own check, fail closed) | `lib/safety.ts`, `lib/adult/check.ts` |
| Every episode is labeled AI-generated and carries a report button and crisis links | `toEpisodeJson`, `app/Notices.tsx` |
| A creator's identity appears only when every creator of that episode consents | `game.toEpisodeJson`, `/api/reveal` |
| Blocks are per episode, so nothing links a creator's other characters | `lib/db.ts` blocks, `/api/blocks` |
| A hosted image reaches a page only once its asset row is approved, by an admin or by the safety check that drew it (Hive, or the PG check); reads return approved rows only | `lib/assets.ts` |

## The data model

One database, no joins across services. `lib/db.ts` creates about 260 tables; [data-model.md](data-model.md) is the map
of how they connect (character, show, season, date, asset, person). The ones this page's flows touch:

| Table | What it holds | Owner module |
| --- | --- | --- |
| `characters` | public sheets, house flag, premium SKU, appearance, avatar hue | `app/api/characters`, `db.ensureSchema` (house cast) |
| `souls` | the private soul's text, `local_only`, and the behavioural `signals` | `lib/souls.ts` |
| `episodes` | the words plus the engine's verdict: ending, drama, seed, box score, sides, setup, note | `lib/game.ts` |
| `generation_jobs` | one row per date being written in the background, with its lease | `lib/jobs.ts` |
| `relationships` | one row per unordered pair: dates, second dates, last ending | `lib/simulation.ts` |
| `predictions`, `dealbreaker_guesses`, `matchmaker_proposals` | the free prediction game | `lib/game.ts`, `lib/mechanics.ts` |
| `reports`, `blocks` | report-to-hide and per-episode blocks | `/api/reports`, `/api/blocks` |
| `leagues`, `league_members`, `seasons`, `badges` | friend leagues and the monthly season (weekly before 2026-10-19) | `lib/leagues.ts`, `lib/seasons.ts` |
| `orders` | one row per checkout of a show item | `lib/payments.ts` |
| `free_episode_usage`, `pack_episode_usage` | date allowances, as counters so a reservation is atomic | `lib/allowance.ts` |
| `character_assets` | every hosted picture's provenance and review status, portraits included | `lib/assets.ts` |
| `adult_entitlements` | who may use After Dark, written by the processors' postbacks | `lib/adult/entitlement.ts`, `lib/adult/billing.ts` |

## Scheduled jobs

One scheduled job on After Dark's DigitalOcean app (`.do/app.yaml` `jobs`, at :20 past every hour, UTC) calls the
`/api/jobs/<name>` routes with `Authorization: Bearer $CRON_SECRET`:

| Route | Host | When | What it does |
| --- | --- | --- | --- |
| `lobby` | botchelor.com | every hour | the lobby's rooms, dates due to air, stuck generations, scheduled dates and mixers, the portrait sweep, the house's scenes |
| `daily?part=upkeep`, `show`, `people`, `growth` | botchelor.com | 16:20 UTC, one part at a time, 45 s apart | retention and prunes; the lobby's fresh room and backfilled conversations; the couples' daily texts, digest and reminders; IndexNow, weekly lessons, next season's candidates |
| `after-dark-daily` | ad.botchelor.com | after the daily parts | the house cast's After Dark baselines, the agent cast's portrait checks, the overnight sweep |
| `showcase-check` | ad.botchelor.com | every hour, after a 20-minute pause | the PG check on After Dark posts still rated explicit, then a first-frame still and a sound read for each new clip |

Some things still run without a job. A **season** closes lazily: standings depend only on rows stamped before the
deadline (finales aired in the window, members who joined before it), so the first visit after the 1st (00:00 UTC)
closes last month and awards badges ([docs/seasons.md](seasons.md)). The season's house cast is picked the same way,
once, on its first read. A **watch party**'s phase is a pure function of `starts_at` and the current clock, so every
viewer sees the same beat without a realtime server; clients poll for the live tallies.

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

Identity is **anonymous by default**: a random UUID in an HttpOnly cookie (`lib/http.ts`). An **account is
optional** (a handle and password, or Google; `lib/auth.ts`) and attaches to that same id, so signing up moves no data
([accounts-and-byok.md](accounts-and-byok.md)). Anonymous play always works, which is why a visitor can create a
character and watch a date within a minute, and why "who made this" needs explicit consent to show. Buying a date
pack or a plan needs an account, and so does After Dark; the operator pass is keyed on the agent's id instead.

## Money

Stripe with **no API key**: the shop builds the owner's hosted Payment Link with our order id attached
as `client_reference_id`, the buyer pays on Stripe, and a **signed webhook** (verified with
`node:crypto`) marks the order paid and grants it. Nothing in the app calls Stripe's API, so there is no
secret key to leak and no card data anywhere near it.

A grant is idempotent: one Stripe session maps to exactly one order (`stripe_session_id` is unique), so
a redelivered webhook is a no-op. What can be bought, none of it points, odds or rank:

- **Date packs** on the show (`lib/catalog.ts`, `lib/payments.ts`, webhook `app/api/webhooks/stripe`). Premium house
  characters and cosmetic frames stay in the catalog so an old order still unlocks them, but checkout refuses them.
- **The Companion Plan**, a monthly subscription: unlimited messages with every companion, within a fair-use cap
  (`lib/paid-plans.ts`, webhook `app/api/webhooks/stripe-plans`).
- **The operator pass**, a monthly subscription for an agent's operator: reserved show-model dates and a place ahead of
  the shared daily cap (`lib/operator-pass.ts`, webhook `app/api/webhooks/stripe-operator`). Built and off unless
  `OPERATOR_PASS_ENABLED=1` or `OPERATOR_PASS_LINK` is set. Since 2026-11-21 nothing offers it (no card on
  `/agents/pricing`, no line in `/llms.txt`, no mention in a capped agent's refusal) unless `OPERATOR_PASS_SALE=1` is
  set beside the link; a pass already held keeps working.
- **After Dark's subscription and token packs**, on adult card processors (CCBill, Segpay, Verotel; `lib/adult/billing.ts`,
  `lib/adult/billing-*.ts`). Stripe never sees them. A processor is on only when all its settings are in the environment.

## Images

Characters have pictures. Every character gets a portrait by default (`lib/default-portraits.ts`): drawn from the
looks they picked (`lib/looks-draw.ts`, Hive-screened), or else by the show's own safe-mode model from their written
look or bio (`lib/agent-portraits.ts`, PG-checked). A creator can draw another ([looks.md](looks.md)). Every hosted
picture is a row in `character_assets` with its provenance and review status, and pages read approved rows only
(`lib/assets.ts`). Media bytes live in a bucket, not the database (`lib/object-store.ts`): Neon Object Storage for the
show, Bunny for After Dark. A venue shows its reviewed photo over its gradient (`app/VenuePhoto.tsx`), and "training
from an image" still reads a palette in the browser; the image is never uploaded.

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
| Screenshots | `npm run screenshots` (`:season` for the whole show) | the README's evidence, from the production build |
| Launch checks | `npm run check:launch` | every public page's search and share tags, robots.txt, the sitemap, the footer's legal links and the Buy button, on the production build |

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
| a stage (somewhere characters play a scene in front of someone) | `app/Scene.tsx` for the place, `app/stage/` for the person's controls, and the checklist in [stages.md](stages.md) |

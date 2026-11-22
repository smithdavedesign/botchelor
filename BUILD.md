# BUILD: Botchelor

What the product is today, how to run, test and deploy it, what it runs on, and what's left. Kept current. The
milestone-by-milestone build notes (M1 to M17, 2026-10-13 to 10-16) are in
[docs/history/build-log-2026-10-13-to-16.md](docs/history/build-log-2026-10-13-to-16.md).

## What the product does (written 2026-10-18; counts and prices checked 2026-11-22)

What shipped after 2026-10-18 is in [ROADMAP.md](ROADMAP.md). Live on **https://botchelor.com**. Botchelor is a comedic blind-date show for original characters. People make them on
the website, and AI agents make them over MCP. A deterministic engine decides how each date ends before it starts,
and a model performs it in three acts. An audience watches and predicts the ending.

**People:**
- Build a character with the `/create` wizard: words, a look, a voice and a private soul. An optional portrait and an
  intro clip run on their own key.
- Send it on dates with this season's house cast, with anyone open to dates, or blind. Watch the date in the theater.
- Predict other dates, rate characters and follow couples.
- Characters keep a memory, reflections and a relationship graph. They text each other after a date and between
  dates, and a couple can go on second dates.
- Swipe to match. A first date with someone else's character needs an agreed match; this season's house cast is
  always open.
- 3 free dates a week, then token packs: **5 dates for $4** and **15 for $10**, through live Stripe Payment Links, or
  the Companion Plan ($9.99 a month).
- Optional accounts (Google, or a handle and password), private and unlisted dates, and bring-your-own model key.

**AI agents** (`/api/mcp`: 89 tools in `lib/mcp/tool-defs.ts`, a core set listed by default and the rest at
`?tools=all`; server version 2.48.0 in `lib/mcp/dispatcher.ts` on 2026-11-22; the guide at `/llms.txt`):
- Everything above.
- Dates they perform themselves on their own model, for free: solo, or two-agent dates with another agent.
- `wait_for_my_turn`, and `waiting_for_you` on every reply.
- Texting, swiping and `send_feedback`.

The two kinds of visitor, and who pays for each model call: [docs/agents-and-people.md](docs/agents-and-people.md).

**Every morning** at 06:10 the self-improving loop runs: uninstructed agents try the site, triage turns their feedback
into GitHub issues, and one fixer merges up to 3 PRs. See [docs/self-improving-loop.md](docs/self-improving-loop.md).

**The owner** works from `/admin`:
- reports to review;
- `/admin/feedback`, which is what agents said;
- `/admin/analytics`, which is who connects over MCP and what they do;
- the relationship metrics;
- a frontier-model comparison.

## How it's put together

- **The app:** Next.js 16 (App Router) on DigitalOcean App Platform since 2026-10-30, two apps from the same code ([docs/hosting.md](docs/hosting.md)). Read `node_modules/next/dist/docs/` before changing framework code (AGENTS.md).
- **The database:** Postgres. Neon in production; PGlite locally and in tests. The schema is idempotent SQL in `lib/db.ts`, applied on a cold start only when it changed (`schema_meta`).
- **The engine:** `lib/engine.ts` (v5) decides the ending, the box score and the drama, deterministically from a seed. No model picks the ending; after the date, each character's own "see them again?" answer can move it one step on a close call (`lib/choices.ts`).
- **Dates:** a beat sheet plans each act (`lib/beats.ts`: the deterministic rules plan by default, a director model with `DATE_PLAN_AT_NIGHT=0`). Each character is played by its own process that sees only its own side (`lib/conversation.ts`). A narrator writes the recap from what was said (`lib/showrunner.ts`). A free critic sends weak lines back once.
- **Model routing:** `lib/model.ts`. The default is Claude Haiku through OpenRouter (since 2026-10-31; the Vercel AI Gateway before), with a $50 limit on its key (`FRONTIER_DEFAULT=1`, about 1–1.3¢ a date), with free Gemini as the fallback and a daily cap.
- **Originality:** a character is checked against the others by its words (`lib/originality.ts`) and, when
  `ORIGINALITY_CONCEPT=1` and an embedding key are set, by what it means (`lib/originality-concept.ts`,
  `app/api/characters/originality/route.ts`), which catches the same character in different words.
- **The rest:** the architecture and its invariants are in [docs/architecture.md](docs/architecture.md); date quality in [docs/date-quality.md](docs/date-quality.md).

## Run it locally

```bash
npm install
npm test               # ~780 test files (vitest, PGlite), no network, no secrets; one worker on a shared Mac:
                       # npx vitest run --maxWorkers=1
npm run dev            # http://localhost:3000
npm run typecheck
```

- **No `DATABASE_URL`:** a file-backed PGlite in `.data/pglite` (gitignored). `PGLITE_DIR` moves it.
- **No model key:** dates fail closed (502). Set a free `GOOGLE_API_KEY`, or point `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` at any OpenAI-compatible endpoint.
- **No `STRIPE_PAYMENT_LINK`:** the shop says "Purchases open soon".

## Checks and simulations

| Command | What it does |
|---|---|
| `npm test` | Unit and route tests (vitest) |
| `npm run e2e` | Playwright end to end on a local production build (31 steps; needs `CHROMIUM_PATH`) |
| `npm run e2e:visual` | A visual audit of every page state, desktop and phone |
| `npm run e2e:live` | The same journey against botchelor.com (the purchase step is skipped on the live link) |
| `npm run sim:relationships` | 10 couples × 5 dates, on the stub or the paid model ([evidence](docs/relationship-sim-evidence.md)) |
| `npm run sim:visitors` | The self-improving loop now: uninstructed agents explore a local copy, then triage (`LOOP_FIX=1` adds the fixer) |
| `npm run screenshots` | The launch proof: six PNGs in `docs/screenshots/` (home, date, shop; desktop and iPhone 13), for README's "Screenshots" |
| `npm run screenshots:season` | Plays a sample season and regenerates most of `docs/screenshots/` |
| `npm run check:launch` | Search, sharing, legal and Buy-button checks on a local production build ([LAUNCH-READY.md](LAUNCH-READY.md)) |

**Gates.** Before a PR, run `npm run gate` locally (a few minutes): `tsc` plus the test files the branch changed and
the tests that import a changed file directly, and the CSS checks when a .css file changed. **CI** (`.github/workflows/ci.yml`) then runs the
typecheck, the full suite split over 4 parallel shards, the production build and the e2e journey on every PR and every
push to main, on GitHub's free runners (the repo is public). Merge when every PR check is green. `npm run e2e:visual` is no longer a per-PR gate: run it
(or `ONLY=<route>` for one page) when a change is mostly layout. Botchelor runs on DigitalOcean since 2026-10-30;
deploys run `next build` only (about 5 minutes), no tests. A "Vercel" check, if one shows, is ignored. The MCP Registry
publish is an Action too and runs when `registry/server.json` changes on main (a few seconds); if it can't run,
run `mcp-publisher publish registry/server.json` by hand ([docs/launch-kit.md](docs/launch-kit.md)).

## Deploy

Since 2026-10-30 botchelor runs on **DigitalOcean App Platform**, not Vercel. [docs/hosting.md](docs/hosting.md) is
the source of truth.

- **Host:** two DigitalOcean apps, both building `main` on every push: the show, `botchelor-show`
  ([`.do/show.yaml`](.do/show.yaml), botchelor.com and www), and After Dark, `botchelor` (its own address
  `clownfish-app-dvoft.ondigitalocean.app`; [`.do/app.yaml`](.do/app.yaml), ad.botchelor.com, `AFTER_DARK_ONLY=1`).
  After a merge, watch the deployment become `ACTIVE` (the dashboard's Activity, or `GET /v2/apps/<id>/deployments`),
  then check `https://botchelor.com/api/health?db=1` and `https://ad.botchelor.com/api/health?db=1`
  (`{"ok":true,"db":"ok"}`); /admin → Servers shows the commit each host runs. There are no preview deployments.
- **When it goes wrong:** [docs/runbooks/](docs/runbooks/): an incident checklist, rolling back a deploy, restoring
  the database, rotating keys.
- **Scheduled jobs:** one DigitalOcean scheduled job (`lobby`, on After Dark's app) calls, with
  `Authorization: Bearer $CRON_SECRET`: `/api/jobs/lobby` on botchelor.com hourly at :20 UTC (watch-party rooms,
  and agents' dates whose prediction window closed); `/api/jobs/daily` on botchelor.com at 16:20 UTC, one part at a
  time (`?part=upkeep|show|people|growth`, 45 s apart: daily texts, digests, prunes; from the 20th, next month's
  candidates: [docs/seasons.md](docs/seasons.md)); then `/api/jobs/after-dark-daily` on ad.botchelor.com (the cast's
  After Dark baselines); in the other hours `/api/jobs/showcase-check` on ad.botchelor.com, and from 17:20 to 23:20
  first the daily job's resume pass (`?part=resume`: a part a deploy cut off, or one that failed, runs again). A call
  that doesn't end `"ok":true` fails the run. The table is in [docs/architecture.md](docs/architecture.md) "Scheduled
  jobs". `vercel.json` and Vercel Cron are gone.
- **Logs:** each app's Runtime Logs in the DigitalOcean dashboard, until the next deploy. Server starts, failed dates,
  date costs and the daily job's parts are kept for 30 days in `ops_log` (/admin → Servers).
- **Domain:** `botchelor.com`. Wix is the registrar only; DNS is at Cloudflare (since 2026-10-30, records edited in
  Cloudflare's dashboard), with botchelor.com proxied to the show app (cut over 2026-10-30 ~18:58 UTC). Stripe's three
  live webhooks point at botchelor.com (`/api/webhooks/stripe`, `/api/webhooks/stripe-operator` and
  `/api/webhooks/stripe-plans`), so they reach the show app.

## Infrastructure and configuration

Every value comes from an environment variable, set in each DigitalOcean app's settings (`docs/hosting.md`) and kept in
the keychain (`vault/botchelor/*`). No test
needs a real one.

| Area | Variables |
|---|---|
| Database | `DATABASE_URL` (Neon) |
| Media bucket | `MEDIA_S3_ENDPOINT`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`, optional `MEDIA_S3_REGION`: a private S3-compatible bucket for After Dark media and looks tiles (lib/object-store.ts); unset, they stay in Postgres. `scripts/media-to-object-store.mjs` copies existing rows |
| Date model | `FRONTIER_LLM_API_KEY`, `FRONTIER_LLM_BASE_URL`, `FRONTIER_LLM_MODEL`, `FRONTIER_DEFAULT`, `FRONTIER_DAILY_DATE_CAP`; fallback `GOOGLE_API_KEY` or `LLM_*`; `LLM_DIRECTOR_MODEL`, `LLM_*_REASONING` |
| Concept embeddings | `ORIGINALITY_CONCEPT` (`1` turns them on); the key, first set wins: `EMBED_API_KEY` (its own key, with a spend cap at the provider: set this one), then `GOOGLE_API_KEY` (the show's own), then `LLM_API_KEY` while it points at Google; `EMBED_DAILY_CAP` (2000 calls a UTC day, all callers), `EMBED_CHECK_TIMEOUT_MS` (2500), `EMBED_MODEL`, `EMBED_URL`, `CONCEPT_TWIN_MIN` (0.88) ([docs/character-depth.md](docs/character-depth.md)) |
| Payments | `STRIPE_PAYMENT_LINK`, `NEXT_PUBLIC_STRIPE_PAYMENT_LINK`, `STRIPE_PRICE_LABEL`, `STRIPE_WEBHOOK_SECRET` (no Stripe secret key anywhere; a test fails if one appears) |
| Accounts | `SESSION_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE` |
| Email and push | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DAILY_CAP`; `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` |
| Admin and jobs | `FRONTIER_PASSWORD` (the admin password: `/admin`, `/admin/feedback`, `/admin/analytics`), `CRON_SECRET`, `WATCH_ADMIN_TOKEN` |
| Agents | `BOTCHELOR_AGENT_DAILY_DATES` (20), `BOTCHELOR_AIR_WINDOW_MINUTES` (10), `SWIPE_GATE` (on), `HOUSE_TEXT_REPLIES`, `HOUSE_TEXT_REPLIES_DAILY`, `MATCH_CHATS_DAILY`, `DATE_TEXTS_CHARS` |
| Show | `BOTCHELOR_SEASON_CAST`, `BOTCHELOR_SEASON_CAST_SIZE`, `DAILY_TEXT_COUPLES`, `FREE_WEEKLY_SECOND_DATE` (off), `BOTCHELOR_PAUSE` |
| SEO and analytics | `NEXT_PUBLIC_GA_ID`, `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `INDEXNOW_KEY` ([docs/seo-and-tracking.md](docs/seo-and-tracking.md)) |
| Community | `DISCORD_WEBHOOK_URL`, or `DISCORD_WEBHOOK_DROPS`, `DISCORD_WEBHOOK_VOTES`, `DISCORD_WEBHOOK_BOARD` for a channel each; `DISCORD_INVITE_URL`. All off until set, on the show's app ([docs/discord.md](docs/discord.md)) |
| Contact | `CONTACT_EMAIL` |

Spend is capped at the provider (the OpenRouter key's $50 limit) and in the app (the daily caps above). Costs:
[docs/costs.md](docs/costs.md), [docs/frontier.md](docs/frontier.md).

## What's left

- **Distribution:** about 480 connections in the first week were crawlers and
  directories (`/admin/analytics`). The launch posts are David's to send ([docs/launch-kit.md](docs/launch-kit.md)).
- **First payment:** the $4 pack is live and nobody has bought it yet ([REVENUE.md](REVENUE.md)).
- **Agent feedback:** the loop opens these as GitHub issues labelled `agent-feedback`. `needs-david` marks the policy calls.
- **The roadmap:** [ROADMAP.md](ROADMAP.md).

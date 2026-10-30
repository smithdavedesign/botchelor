# BUILD: Botchelor

What the product is today, how to run, test and deploy it, what it runs on, and what's left. Kept current. The
milestone-by-milestone build notes (M1 to M17, 2026-10-13 to 10-16) are in
[docs/history/build-log-2026-10-13-to-16.md](docs/history/build-log-2026-10-13-to-16.md).

## What the product does now (2026-10-18)

Live on **https://botchelor.com**. Botchelor is a comedic blind-date show for original characters. People make them on
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
- 3 free dates a week, then token packs: **5 dates for $4**, through a live Stripe Payment Link.
- Optional accounts (Google, or a handle and password), private and unlisted dates, and bring-your-own model key.

**AI agents** (`/api/mcp`, about 46 tools, with the guide at `/llms.txt`):
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

- **The app:** Next.js 16 (App Router) on Vercel. Read `node_modules/next/dist/docs/` before changing framework code (AGENTS.md).
- **The database:** Postgres. Neon in production; PGlite locally and in tests. The schema is idempotent SQL in `lib/db.ts`, applied on a cold start only when it changed (`schema_meta`).
- **The engine:** `lib/engine.ts` (v3) decides the ending, the box score and the drama, deterministically from a seed. Models never decide outcomes.
- **Dates:** a director plans the beats (`lib/beats.ts`). Each character is played by its own process that sees only its own side (`lib/conversation.ts`). A narrator writes the recap from what was said (`lib/showrunner.ts`). A free critic sends weak lines back once.
- **Model routing:** `lib/model.ts`. The default is Claude Haiku through the Vercel AI Gateway, on prepaid credit (`FRONTIER_DEFAULT=1`, about 1–1.3¢ a date), with free Gemini as the fallback and a daily cap.
- **The rest:** the architecture and its invariants are in [docs/architecture.md](docs/architecture.md); date quality in [docs/date-quality.md](docs/date-quality.md).

## Run it locally

```bash
npm install
npm test               # ~1170 tests (vitest, PGlite), no network, no secrets
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
| `npm run screenshots` | Regenerates `docs/screenshots/` |

**CI** (`.github/workflows/ci.yml`: typecheck and `npm test`) runs by hand only (`gh workflow run ci.yml --ref
<branch>`), since 2026-10-21: the repo is private, so every run spends the account's free Actions minutes, which
RepoHQ needs. PRs merge after `npx tsc --noEmit -p .` and the full `npx vitest run` pass locally on the branch merged
with current main (say so on the PR); the check left on a PR is GitGuardian. Since 2026-10-30 the red "Vercel" check
is expected (Vercel's free plan can't build botchelor) and ignored. The MCP Registry
publish is an Action too and still runs when `registry/server.json` changes on main (a few seconds); while the
minutes are out, run `mcp-publisher publish registry/server.json` by hand ([docs/launch-kit.md](docs/launch-kit.md)).

## Deploy

Since 2026-10-30 botchelor runs on **DigitalOcean App Platform**, not Vercel. [docs/hosting.md](docs/hosting.md) is
the source of truth.

- **Host:** two DigitalOcean apps, both building `main` on every push: the show, `botchelor-show`
  ([`.do/show.yaml`](.do/show.yaml), botchelor.com and www), and After Dark, `clownfish-app`
  ([`.do/app.yaml`](.do/app.yaml), ad.botchelor.com, `AFTER_DARK_ONLY=1`). After a merge, watch the deployment become
  `ACTIVE` (the dashboard's Activity, or `GET /v2/apps/<id>/deployments`), then check
  `https://botchelor.com/api/health`. There are no preview deployments.
- **Scheduled jobs:** one DigitalOcean scheduled job (`lobby`, on After Dark's app) calls `/api/jobs/lobby` hourly at
  :20 UTC (watch-party rooms, and agents' dates whose prediction window closed), `/api/jobs/daily` at 16:20 UTC (daily
  texts, digests, prunes; from the 20th, next month's candidates, and the cast's After Dark baselines:
  [docs/seasons.md](docs/seasons.md)), and `/api/jobs/showcase-check` about 20 minutes after each lobby run, all on
  botchelor.com with `Authorization: Bearer $CRON_SECRET`. `vercel.json` and Vercel Cron are gone.
- **Logs:** each app's Runtime Logs in the DigitalOcean dashboard.
- **Domain:** `botchelor.com`. Wix is the registrar only; DNS is moving to Cloudflare (from 2026-10-30, records edited
  in Cloudflare's dashboard). Until that cutover, botchelor.com still serves the last Vercel build. The Stripe webhook
  still points at `botchelor.vercel.app`: moving it to `https://botchelor.com/api/webhooks/stripe` in Stripe's
  dashboard is David's, pending.

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
| Contact | `CONTACT_EMAIL` |

Spend is capped at the provider (the AI Gateway's prepaid balance) and in the app (the daily caps above). Costs:
[docs/upgrade-cost.md](docs/upgrade-cost.md), [docs/frontier.md](docs/frontier.md).

## What's left

- **Distribution:** no outside agent has played yet. About 480 connections in the first week were crawlers and
  directories (`/admin/analytics`). The launch posts are David's to send ([docs/launch-kit.md](docs/launch-kit.md)).
- **First payment:** the $4 pack is live and nobody has bought it yet ([REVENUE.md](REVENUE.md)).
- **Originality at the concept level:** agents keep inventing near-identical characters, and the check compares words.
- **Agent feedback:** the loop opens these as GitHub issues labelled `agent-feedback`. `needs-david` marks the policy calls.
- **The roadmap:** [ROADMAP.md](ROADMAP.md).

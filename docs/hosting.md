# Hosting

**Since 2026-10-30, botchelor runs on DigitalOcean App Platform, not Vercel.** David moved the Vercel team to the free
(Hobby) plan, which can't deploy this app: it allows at most 12 functions per deployment (botchelor has hundreds of
routes), only daily cron jobs, and no commercial use. So the show moved to DigitalOcean, next to After Dark's own host.

| | What | Spec | Cost |
|---|---|---|---|
| The show | `botchelor.com`, `www.botchelor.com` | [`.do/show.yaml`](../.do/show.yaml) | $12 a month (1 vCPU, 1 GiB) |
| After Dark | `ad.botchelor.com` | [`.do/app.yaml`](../.do/app.yaml), runbook [after-dark-hosting.md](after-dark-hosting.md) | $10 a month |
| Scheduled jobs | the lobby (hourly), the showcase check (hourly, which also cuts a first-frame still for each new clip: lib/showcase-posters.ts), the daily job | a job on After Dark's app (`.do/app.yaml` `jobs`) | at most $5 a month |
| After Dark's media | `media.botchelor.com` | Bunny (runbook) | about $1–6 a month |

The database (Neon) and the show's media bucket (Neon Object Storage) didn't move.

**Both apps run in San Francisco (`sfo`) since 2026-11-04**, next to the database in Oregon (Neon `aws-us-west-2`).
They started in New York, so every query crossed the country (~40–70 ms each; heavy pages wait on several in a row).
The move was `region` in each app's spec, at the same price; Bunny's storage zone stayed in New York.

## What changed in the code

- **Production is `DEPLOY_ENV=production`** off Vercel (`lib/deploy.ts`), as `VERCEL_ENV=production` was on Vercel:
  live Stripe links only, test events never grant, IndexNow pings, the funnel beacon, Hive always on.
- **The site's address is `SITE_URL`** (`lib/site.ts`): links in guides, the MCP discovery file and sitemaps name
  botchelor.com, never the server's internal address.
- **Vercel Web Analytics and Speed Insights** are gone, packages and all (2026-10-31), with `@vercel/functions`'
  metrics. Google Analytics and the `track()` analytics log lines are unchanged.
- **Where a visitor is** (`lib/place.ts`): Vercel's location headers are gone. Without them a visitor's country is
  unknown, which is safe on both sides: the EU consent banner shows to everyone who hasn't chosen, and After Dark
  stays closed to everyone but admins. So botchelor.com sits behind our own Cloudflare zone (free) with the "Add visitor
  location headers" managed transform on, and the show has `GEO_HEADERS=cloudflare`: `cf-ipcountry` and
  `cf-region-code` give the country and the US state (both on since 2026-10-30; checked: a signed-out After Dark hop
  carries `place.v1.US.CA`).
- **Scheduled jobs** call `https://botchelor.com/api/jobs/<name>` with `Authorization: Bearer $CRON_SECRET`, as Vercel
  Cron did. The daily job goes one part per request (`?part=upkeep|show|people|growth`, 45 s apart), and each part's
  answer streams newlines until it's done, so the next part never starts while one is still running. Run whole, it held
  the show's one instance for minutes and botchelor.com answered 504 for ~5 and ~9 minutes on 2026-11-11. Each part's
  time, memory peak and longest event-loop stall go to `job_runs` (`lib/job-meter.ts`) and show in the monitor's
  `/api/health` (`daily_job`, with the instance's memory under `process`).
- **Long requests:** App Platform has no `maxDuration`. Its edge (Cloudflare) ends a response that sends nothing for
  100 seconds, so streams keep sending, and slow work runs in `after()` once the response is out, as before.
  MCP waits (`wait_seconds`) still sometimes got a bare `error code: 504` from it at 50 seconds, though 40 or less never
  did (#1057), so a wait is capped at 30 (`WAIT_MAX_SECONDS`), and the cheatsheets say a bare 504 on a wait is safe to retry.

## Deploys

Both apps build `main` on every push (`deploy_on_push`). A deploy is live when its app's deployment is `ACTIVE`:
DigitalOcean dashboard → Apps → the app → Activity, or the API (`GET /v2/apps/<id>/deployments`). Pull requests get no
preview deployment any more: merge on the local checks (`tsc`, the full test suite) and GitGuardian, then watch the
deploy and check `https://botchelor.com/api/health`. Since 2026-10-31 the Vercel project skips every build (Settings →
Git → Ignored Build Step is `exit 0`), so it no longer fails on Hobby; if a "Vercel" check still shows on a pull request,
ignore it.

## Settings and logs

- **Environment variables** live in each app's settings: DigitalOcean → Apps → the app → Settings → App-Level (or the
  component's) Environment Variables, or the API (`PUT /v2/apps/<id>` with the spec). Values come from the keychain
  (`vault/botchelor/<NAME>`); secrets are marked Encrypt. Not `vercel env` any more. The show's Discord
  (`DISCORD_WEBHOOK_URL`, `DISCORD_WEBHOOK_DROPS`, `DISCORD_WEBHOOK_VOTES`, `DISCORD_WEBHOOK_BOARD`,
  `DISCORD_INVITE_URL`) goes on the show's app, `botchelor-show`: the hourly job is scheduled from After Dark's app,
  but it calls `botchelor.com/api/jobs/lobby`, which the show serves ([discord.md](discord.md)).
- **`FIRST_DATE_FORMAT`** (the show's app, not a secret; default `speed_date`): the format a newcomer's instant first
  date plays in (`lib/first-date.ts` `firstDateFormat`). The builder's "Start the date now" card sends it with the
  booking, so the first verdict comes in about a minute (6 lines) instead of the classic date's two-plus. Set it to
  another free format's id (`classic`, `meet_the_parents`, `ex_returns`) to change the first date without a deploy; a
  premium or unknown id falls back to `speed_date`. Commented in `.do/show.yaml` beside the other switches.
- **`FAST_FIRST_LINE`** (the show's app, not a secret; default: speed dates): which formats start fast
  (`lib/fast-date.ts`): no director call in front of the first line, a 2.5 s limit on a new character's hot takes
  (`HOT_TAKES_WAIT_MS`), and the recap, texts and reflections written side by side. `0` or `off` puts every date back
  on the old order without a deploy; `all` starts every format fast (the classic date waits 50 s on a plan that hasn't
  been arriving: [date-quality.md](date-quality.md), "Round: the fast first date", which has the measurements and the
  query to check the result). **`SPEED_DATE_MODEL`** and **`SPEED_DATE_REASONING`** (both unset: the show's model as
  it is) put a speed date's lines, answers, texts and reflections on another model id at the show's paid endpoint, or
  on another thinking level (`minimal`, `low`, `medium`, `high`); the measurements there say leave them unset.
  Commented in `.do/show.yaml`.
- **`EXPRESS_CREATE`** (the show's app, not a secret; on unless `0`): one-sentence create, the one-box first screen of
  `/create` for a first character (`lib/express-create.ts`, [flows.md](flows.md)). `0` restores the form as the first
  step and `POST /api/characters/draft` answers 404.
- **`CHARACTER_QUESTIONS`** (the show's app, not a secret; on unless `0`): the daily job's `character_questions` step, a
  character asking its opted-in owner about its own sheet (`lib/character-questions.ts`, [companions.md](companions.md)).
  `0` sends none; an answer box already in a thread still saves.
- **`LIFE_DATES_PER_DAY`** (the show's app, not a secret; default `30`): how many life dates the daily job books a day
  (`lib/character-life.ts weeklyLifeDates`): the house takes each owned character out once a week, house-paid, on the
  show's model (~1¢ each). `0` turns them off without a deploy; nothing books while `BOTCHELOR_PAUSE` is on or the paid
  model's daily date cap (`FRONTIER_DAILY_DATE_CAP`) is spent. Commented in `.do/show.yaml`; the rules are in
  [companions.md](companions.md), "Your character lives without you".
- **`STEP_IN_OPEN`, `STEP_IN_GUESTS`, `STEP_IN_GUEST_DAILY_MAX`** (the show's app, not secrets): step into the date is
  open to everyone since 2026-11-15, guests included. `STEP_IN_OPEN=0` puts it back to admins only; `STEP_IN_GUESTS=0`
  asks a visitor without an account to sign in first; `STEP_IN_GUEST_DAILY_MAX` (default `300`) is the guest dates a day
  across the show, the bound on what guests can cost (about $2 a day at the default). Commented in `.do/show.yaml`; the
  caps and the cost are in [step-into-the-date.md](step-into-the-date.md), "What stops a flood".
- **`MODEL_LEAGUE`** (the show's app, not a secret; default on): the model league, `/agents/league` and
  `/api/league/models` (`lib/model-league.ts`; [agents-and-people.md](agents-and-people.md)). `0` takes the page, its
  JSON, its sitemap entry and the links to it (`/agents`, `llms.txt`) away without a deploy; agents' `model` is still
  kept and dates are still stamped, so turning it back on loses nothing. Commented in `.do/show.yaml`.
- **`DATE_PHOTO_TEXTS`**, **`COMPANION_DATE_OPENER`**, **`HOME_PHONE`** (the show's app, not secrets; all on by
  default, `0` turns one off without a deploy of code): a photo from the date in the character's texts
  (`lib/date-photo.ts`; off: texts go without one, the photos already sent stay), a cast character's opener written from
  its last aired date (`lib/cast-opener.ts`; off: the model writes the hello and the cast's prompt has no last-date
  block), and the owner's home opening on their character's phone (`lib/character-phone.ts`; off: the home page as it
  was). The rules are in [companions.md](companions.md) and [flows.md](flows.md).
- **The packs' Payment Links** (the show's app; the links aren't secret, the webhook secret is). One link sells one
  thing in Stripe, so each pack has its own ([pricing-and-byok.md](pricing-and-byok.md)):

  | Env | What | Default |
  |---|---|---|
  | `STRIPE_PAYMENT_LINK` (or `STRIPE_LINK_PACK_5`) | pack_5's link, "5 more dates" for $4 | unset: the shop says "purchases open soon" |
  | `STRIPE_PRICE_LABEL` (or `STRIPE_PRICE_LABEL_PACK_5`) | pack_5's Buy button text | "Buy 5 more dates for $4" |
  | `STRIPE_LINK_PACK_15` | pack_15's link, "15 more dates" for $10 (make it in Stripe: a $10 one-time Payment Link) | unset: the tile isn't shown and checkout answers 503 for it |
  | `STRIPE_PRICE_LABEL_PACK_15` | pack_15's Buy button text | "Buy 15 more dates for $10" |
  | `STRIPE_WEBHOOK_SECRET` | the one webhook endpoint both links' sessions report to | required for any grant |

  The webhook grants a pack only when the session's amount covers the pack's list price and its link isn't one already
  known to sell another pack (`lib/payments.ts grantOrder`), so a mixed-up env can't hand out the bigger pack for the
  smaller price.
- **Logs:** each app's Runtime Logs in the dashboard (Apps → the app → Runtime Logs). Everything that used to go to
  Vercel's runtime logs (`episode_generated` with `cost_usd`, the `"log":"analytics"` lines) goes there now.

## DNS: Cloudflare (from 2026-10-30)

Wix is only the registrar now. DNS moved off Wix to DigitalOcean's DNS on 2026-10-30, then to **Cloudflare** the same
day (free plan; nameservers `kolton.ns.cloudflare.com` and `nucum.ns.cloudflare.com`). Records are edited in
Cloudflare's dashboard: botchelor.com → DNS → Records. botchelor.com itself moved from Vercel to the show app at about
18:58 UTC on 2026-10-30.

**Adding a proxied name (the lesson of 2026-10-30).** DigitalOcean only accepts a custom domain once it sees a CNAME
pointing at the app, and the orange cloud hides that CNAME. So add the record as **DNS only** first, add the domain to
the app (Settings → Domains, "you manage your domain"), wait until it answers on its own (can take up to an hour; the
dashboard's status lags), and only then switch it to Proxied. A name switched to Proxied before DigitalOcean has it gets
Cloudflare's 526 for every visitor, which is what botchelor.com did for ~5 minutes that evening.

| Host | Proxy | Points to |
|---|---|---|
| `@` | **Proxied** (orange cloud) | CNAME (flattened) → `botchelor-show-t9g76.ondigitalocean.app` |
| `www` | DNS only | the show app's `ondigitalocean.app` address |
| `ad` | DNS only | After Dark's app's (`clownfish-app`) `ondigitalocean.app` address |
| `media` | DNS only | `botchelor-ad-media.b-cdn.net` |
| `staging` | DNS only | the show app's `ondigitalocean.app` address (reaches the show without www's redirect) |

Resend's records (`send`, `rsend`, `resend._domainkey`, `_dmarc`) and Glama's TXT record (`_glama-claim.www`) stay as
they are. Cloudflare's "Add visitor location headers" managed transform is on (Rules → Settings) and the show app has
`GEO_HEADERS=cloudflare` ("Where a visitor is", above).

At DigitalOcean the show app lists `botchelor.com` (primary), `www.botchelor.com` and `staging.botchelor.com`, all as
"you manage your domain" (no zone): DigitalOcean's own DNS zone for botchelor.com is no longer used. The `edge` test name
was removed from the app on 2026-10-31.

## botchelor.vercel.app

Gone: David deleted the Vercel project on 2026-10-31, and the old address answers 404 (`DEPLOYMENT_NOT_FOUND`, checked
2026-11-04). Agents still set up with `botchelor.vercel.app/api/mcp` have to move to botchelor.com.

Stripe's webhooks never used it: every live endpoint points at botchelor.com (`/api/webhooks/stripe` for packs,
`/api/webhooks/stripe-operator` for the operator pass, `/api/webhooks/stripe-plans` for the Companion Plan), so they
reach the show app. None pins an API version, so each gets the account's default (2026-09-30.endive on 2026-11-04);
`lib/stripe.ts` reads the fields that moved in 2025-03-31 from both places.

## Going back to Vercel

Re-upgrade the Vercel team to Pro, restore `vercel.json`'s crons from git history, point `@` and `www` back at Vercel's
records in Cloudflare (`216.150.1.1`, `216.150.16.1`, `www` → `3213a098f8021dad.vercel-dns-017.com`, DNS only), and
remove the scheduled job from `.do/app.yaml`. The code runs on either: on Vercel, `VERCEL_ENV` and Vercel's headers
take over again.

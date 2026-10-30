# Hosting

**Since 2026-10-30, botchelor runs on DigitalOcean App Platform, not Vercel.** David moved the Vercel team to the free
(Hobby) plan, which can't deploy this app: it allows at most 12 functions per deployment (botchelor has hundreds of
routes), only daily cron jobs, and no commercial use. So the show moved to DigitalOcean, next to After Dark's own host.

| | What | Spec | Cost |
|---|---|---|---|
| The show | `botchelor.com`, `www.botchelor.com` | [`.do/show.yaml`](../.do/show.yaml) | $12 a month (1 vCPU, 1 GiB) |
| After Dark | `ad.botchelor.com` | [`.do/app.yaml`](../.do/app.yaml), runbook [after-dark-hosting.md](after-dark-hosting.md) | $10 a month |
| Scheduled jobs | the lobby (hourly), the showcase check (hourly), the daily job | a job on After Dark's app (`.do/app.yaml` `jobs`) | at most $5 a month |
| After Dark's media | `media.botchelor.com` | Bunny (runbook) | about $1–6 a month |

The database (Neon) and the show's media bucket (Neon Object Storage) didn't move.

## What changed in the code

- **Production is `DEPLOY_ENV=production`** off Vercel (`lib/deploy.ts`), as `VERCEL_ENV=production` was on Vercel:
  live Stripe links only, test events never grant, IndexNow pings, the funnel beacon, Hive always on.
- **The site's address is `SITE_URL`** (`lib/site.ts`): links in guides, the MCP discovery file and sitemaps name
  botchelor.com, never the server's internal address.
- **Vercel Web Analytics and Speed Insights** only render on Vercel, so they're off. Google Analytics is unchanged.
- **Where a visitor is** (`lib/place.ts`): Vercel's location headers are gone. Without them a visitor's country is
  unknown, which is safe on both sides: the EU consent banner shows to everyone who hasn't chosen, and After Dark
  stays closed to everyone but admins. Before After Dark opens to subscribers, put botchelor.com behind our own
  Cloudflare zone (free) with the "Add visitor location headers" managed transform on, and set `GEO_HEADERS=cloudflare`
  on the show: then `cf-ipcountry` and `cf-region-code` give the country and the US state.
- **Scheduled jobs** call `https://botchelor.com/api/jobs/<name>` with `Authorization: Bearer $CRON_SECRET`, as Vercel
  Cron did.
- **Long requests:** App Platform has no `maxDuration`. Its edge (Cloudflare) ends a response that sends nothing for
  100 seconds, so streams keep sending, and slow work runs in `after()` once the response is out, as before.

## Deploys

Both apps build `main` on every push (`deploy_on_push`). A deploy is live when its app's deployment is `ACTIVE`:
DigitalOcean dashboard → Apps → the app → Activity, or the API (`GET /v2/apps/<id>/deployments`). Pull requests get no
preview deployment any more: merge on the local checks (`tsc`, the full test suite), then watch the deploy.

## DNS (Wix)

| Host | Type | Points to |
|---|---|---|
| `@` | A | the show app's two ingress addresses (DigitalOcean shows them under Settings → Domains) |
| `www` | CNAME | the show app's `ondigitalocean.app` address |
| `ad` | CNAME | After Dark's app's `ondigitalocean.app` address |
| `media` | CNAME | `botchelor-ad-media.b-cdn.net` |

Resend's records (`send`, `rsend`, `resend._domainkey`, `_dmarc`) stay as they are.

## botchelor.vercel.app

The old address keeps serving the last deployment Vercel built (older code, the same database) for as long as the
Vercel project exists. Stripe's webhook pointed there: move it to `https://botchelor.com/api/webhooks/stripe` in
Stripe's dashboard (editing the endpoint's URL keeps its signing secret), and do the same for the operator pass's
webhook. Agents still connected to `botchelor.vercel.app/api/mcp` keep working on the old code until they reconnect.

## Going back to Vercel

Re-upgrade the Vercel team to Pro, restore `vercel.json`'s crons from git history, point `@` and `www` back at Vercel's
records (`216.150.1.1`, `216.150.16.1`, `www` → `3213a098f8021dad.vercel-dns-017.com`), and remove the scheduled job
from `.do/app.yaml`. The code runs on either: on Vercel, `VERCEL_ENV` and Vercel's headers take over again.

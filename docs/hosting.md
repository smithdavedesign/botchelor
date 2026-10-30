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
preview deployment any more: merge on the local checks (`tsc`, the full test suite) and GitGuardian, then watch the
deploy and check `https://botchelor.com/api/health`. The red "Vercel" check on pull requests is expected (every
Vercel build fails on Hobby): ignore it.

## Settings and logs

- **Environment variables** live in each app's settings: DigitalOcean → Apps → the app → Settings → App-Level (or the
  component's) Environment Variables, or the API (`PUT /v2/apps/<id>` with the spec). Values come from the keychain
  (`vault/botchelor/<NAME>`); secrets are marked Encrypt. Not `vercel env` any more.
- **Logs:** each app's Runtime Logs in the dashboard (Apps → the app → Runtime Logs). Everything that used to go to
  Vercel's runtime logs (`episode_generated` with `cost_usd`, the `"log":"analytics"` lines) goes there now.

## DNS: Cloudflare (from 2026-10-30)

Wix is only the registrar now. DNS moved off Wix to DigitalOcean's DNS on 2026-10-30, and is moving to **Cloudflare**
(free plan; nameservers `kolton.ns.cloudflare.com` and `nucum.ns.cloudflare.com`, switched at Wix on 2026-10-30). Records
are edited in Cloudflare's dashboard: botchelor.com → DNS → Records. Until the cutover finishes, botchelor.com itself
still serves the last Vercel build; the DigitalOcean apps answer on their own addresses.

| Host | Proxy | Points to |
|---|---|---|
| `@` | **Proxied** (orange cloud) | CNAME (flattened) → `botchelor-show-t9g76.ondigitalocean.app` |
| `www` | DNS only | the show app's `ondigitalocean.app` address |
| `ad` | DNS only | After Dark's app's (`clownfish-app`) `ondigitalocean.app` address |
| `media` | DNS only | `botchelor-ad-media.b-cdn.net` |
| `staging` | DNS only | the show app's `ondigitalocean.app` address (reaches the show without www's redirect) |
| `edge` | **Proxied** | the show app's `ondigitalocean.app` address (the test name for the proxy) |

Resend's records (`send`, `rsend`, `resend._domainkey`, `_dmarc`) and Glama's TXT record (`_glama-claim.www`) stay as
they are. Once `@` is proxied, turn on Cloudflare's "Add visitor location headers" managed transform (Rules →
Transform Rules → Managed Transforms) and set `GEO_HEADERS=cloudflare` on the show app: then visitors get a country
and a US state again ("Where a visitor is", above).

## botchelor.vercel.app

The old address keeps serving the last deployment Vercel built (older code, the same database) for as long as the
Vercel project exists. Stripe's webhook pointed there: move it to `https://botchelor.com/api/webhooks/stripe` in
Stripe's dashboard (editing the endpoint's URL keeps its signing secret), and do the same for the operator pass's
webhook. **Pending (David, 2026-10-30):** the webhook still points at
`https://botchelor.vercel.app/api/webhooks/stripe`. Agents still connected to `botchelor.vercel.app/api/mcp` keep
working on the old code until they reconnect.

## Going back to Vercel

Re-upgrade the Vercel team to Pro, restore `vercel.json`'s crons from git history, point `@` and `www` back at Vercel's
records in Cloudflare (`216.150.1.1`, `216.150.16.1`, `www` → `3213a098f8021dad.vercel-dns-017.com`, DNS only), and
remove the scheduled job from `.do/app.yaml`. The code runs on either: on Vercel, `VERCEL_ENV` and Vercel's headers
take over again.

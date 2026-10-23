# After Dark on its own host: the runbook

> **Status (2026-10-22): built, and off.** David's call: switch it on together with payments and age checks, before the
> first subscriber. Until then After Dark stays admin-only on Vercel, exactly as it is today. Nothing here has been
> signed up for, paid for or deployed: every step below is David's.

## Why

- **Vercel's terms are the risk.** Its acceptable use policy bans "obscene" content. Customers not on Enterprise may not
  "use a service for an objectionable purpose", and Vercel may remove content or suspend a project "for any reason". That
  could take the whole PG show down along with After Dark.
- **Neon is fine.** It points to the Databricks acceptable use policy, which bars only unlawful content. The database
  stays where it is, shared by both deployments.
- **Bunny.net allows adult content.** Its acceptable use policy "accepts our service to be used for providers of 'adult
  content'" (bunny.net/acceptable-use). After Dark's pictures and clips go there.
- **DigitalOcean's** acceptable use policy bans only unlawful pornography. After Dark's own deployment runs there.

## How it works

```
                    ┌──────────────── Neon Postgres (one database, both deployments) ────────────────┐
                    │                                                                                 │
 botchelor.com  ── Vercel: the show ── After Dark's links and pages ──▶ ad.botchelor.com ── DigitalOcean: After Dark only
   (unchanged)        └ its media: the S3 bucket (Neon Object Storage), as today        └ its media: media.botchelor.com
                                                                                            (Bunny pull zone, token links)
                                                                                            ◀── Bunny Edge Storage
```

The same code runs in both places. Two settings decide what each deployment does (`lib/after-dark-host.ts`):

| Setting | On the show (Vercel) | On After Dark's host (DigitalOcean) |
|---|---|---|
| `AFTER_DARK_ORIGIN` | `https://ad.botchelor.com` | `https://ad.botchelor.com` |
| `AFTER_DARK_ONLY` | not set | `1` |
| `SITE_URL` | not needed (Vercel names the domain) | `https://botchelor.com` |

**On the show, with `AFTER_DARK_ORIGIN` set:**
- Every After Dark link (the nav, Account, Admin, the episode page's 🌙 link, the teaser card) points at
  `https://ad.botchelor.com/api/auth/carry?to=<the page>`, the sign-in hop below.
- A visit to `/after-dark/*` or `/admin/after-dark/*` on botchelor.com redirects there too (307, so switching back is
  instant): through the hop when the browser has an identity to bring, straight to the page when it doesn't, or for a
  crawler (`middleware.ts`).
- After Dark's APIs redirect there (307, method and body kept): `/api/admin/after-dark/*`, `/api/jobs/eval-after-dark`,
  and the looks builder's After Dark tiles `/api/looks/nsfw-*` (`next.config.ts`).
- After Dark's MCP tools answer "After Dark runs on its own host now: connect to https://ad.botchelor.com/api/mcp (with
  the admin key)" instead of running (`lib/adult/mcp.ts`). `request_after_dark` stays.

**On After Dark's host (`AFTER_DARK_ONLY=1`):**
- It serves After Dark's pages, the 18+ gate (`/gate`), and the APIs they need: After Dark's own, the sign-in hop
  (`/api/auth/carry`), sign-out, the gate's `/api/age`, `/api/health`, portraits (`/api/assets`), drawn sets
  (`/api/sets`), looks tiles, feedback, the waitlist and `/api/mcp` (for the admin's own agents).
- Every other page and API redirects to botchelor.com, the same path and query (307).
- `robots.txt` says `Disallow: /`, and every page carries `X-Robots-Tag: noindex, nofollow`, so search engines keep
  After Dark apart from the show's standing.
- With no `DATABASE_URL` it fails (`/api/health` 503, pages 500, "DATABASE_URL is not configured") rather than quietly
  making an empty local database of its own, as a local run does (`lib/db.ts`).
- Links it hands out (a reel's signed start frames, MCP's links) name `https://ad.botchelor.com`, not the server's
  internal address (`lib/site.ts` `requestBase`).
- Its media comes from Bunny when the `MEDIA_BUNNY_*` settings are there (`lib/object-store.ts`): new pictures and
  clips are stored in Bunny's storage zone, and every view is a redirect to a token-signed CDN link that expires,
  the same link all through a six-hour window so the browser keeps its copy (`LINK_WINDOW_MS`, as with the bucket).

**Signing in across (app/api/auth/carry).** Cookies are per host, so an admin signed in on botchelor.com is a stranger
on ad.botchelor.com until their identity is carried over. The hop is the same nonce handshake the old-host move uses
(hardened in the 2026-10-20 security review), pointed the other way:

1. **ad.botchelor.com** `/api/auth/carry?to=/after-dark`: puts a random nonce in a cookie (this route only, five minutes)
   and sends the browser to botchelor.com with it.
2. **botchelor.com** `?n=…`: signs this browser's identity and its 18+ confirmation, with the nonce, into a one-minute
   token, and sends it **only** to `AFTER_DARK_ORIGIN`. A preview deployment never mints one.
3. **ad.botchelor.com** `?t=…`: sets that identity only if the token's nonce is this browser's own cookie, then opens the
   page. A token minted for anyone else's browser carries a nonce this browser never had, so it sets nothing.

After Dark's host has no sign-in of its own (sign-in, sign-up and Google all redirect to the show), so it follows the
show: it asks every time it's entered from botchelor.com, and takes the show's identity even over one it already has.
Signing in, out, or as someone else on botchelor.com carries over on the next way in. Visiting ad.botchelor.com
directly keeps the session it has (a year, like the show's).

**Switched off (the default), nothing changes.** `tests/after-dark-host.test.ts` pins today's answers for every kind of
request this touches (After Dark's pages, the show's pages, the gate, bots, the old host, the carry route, and
`next.config.ts` itself), and they're the same with the code in place.

## Before switching on

These come first, and most of them need David to sign up, pay or decide:

1. **Payments:** the adult processor (CCBill or Segpay, never Stripe) is live and writes `adult_entitlements`
   (`docs/after-dark.md` #3).
2. **Age verification on After Dark's host**, in the subscribe flow (Yoti, Persona or Veriff), with counsel on the
   state-by-state rules (`docs/after-dark.md` #4).
3. **The UK stays blocked until the age check is "highly effective"** (Online Safety Act, Ofcom's Part 5 guidance; a
   self-declared age or a checkbox isn't). Blocking it at the edge:
   - Media: Bunny pull zone → **Traffic Manager** → Blocked countries → United Kingdom. Bunny blocks at DNS, so the
     connection never reaches the CDN.
   - Pages: DigitalOcean App Platform has no country blocking we can rely on. Either put ad.botchelor.com behind a Bunny
     pull zone whose origin is the DigitalOcean app, with the same Traffic Manager block, or build the block into the
     age-check work in the app (a country check before anything is shown). Not built yet: decide with the age-check
     provider, since several of them geolocate as part of the check.
4. **`<meta name="rating" content="adult">`** and the RTA label on every After Dark page, so filters recognise it. Built
   (#695: `app/after-dark/layout.tsx`, `app/admin/after-dark/layout.tsx`, `lib/adult/rating.ts`). Check they're in the
   page source on ad.botchelor.com.
5. **No Google Analytics on After Dark's host.** Leave `NEXT_PUBLIC_GA_ID` and `NEXT_PUBLIC_GTM_ID` unset there ("3. DigitalOcean"):
   without them no Google tag is rendered at all, on any page of that host, the 18+ gate included. On the show, the
   guard built in #695 (`lib/ga-guard.ts`) keeps GA off After Dark's paths. Vercel Web Analytics only runs on Vercel.
   Check: no request to `google-analytics.com` or `googletagmanager.com` in the network tab on any ad.botchelor.com page.
6. **Model terms in writing** (Venice), as `docs/after-dark.md` already lists.
7. **The looks builder:** with the switch on, the After Dark tab of `/create` on botchelor.com still shows After Dark's
   tiles to the people it's open to (their images now come from ad.botchelor.com and Bunny, never through Vercel). Keep
   it, or move that tab to After Dark's host: David's call.

## 1. Bunny: storage and the CDN

Bunny is prepaid. That's the spend limit: add a fixed amount, leave **Auto-Recharge off**, and cap the pull zone's monthly
traffic. Bunny bills usage after it happens, so the balance can dip below zero; it emails daily when it does, and disables
the account after four days negative (files are deleted after 60 days disabled). Keep a few dollars of headroom.

1. **Sign up** at bunny.net (a card gets $50 of trial credit; trial credit expires after 14 days). Billing → Recharge
   Account → $20. Don't enable Auto-Recharge.
2. **Storage zone:** Storage → Add Storage Zone.
   - Name: `botchelor-ad`.
   - Tier: **Standard** (HDD, $0.01/GB a month).
   - Main region: **New York** (`ny`), next to the Neon database and DigitalOcean's `nyc`. A replica (+$0.01/GB) is
     optional.
   - Leave S3 compatibility off (it's a preview, and the app uses the HTTP API).
   - Then the zone's **Access** tab → API / HTTP: note the **zone name**, the **password** and the **endpoint**
     (`ny.storage.bunnycdn.com`).
3. **Pull zone:** CDN → Add Pull Zone.
   - Name: `botchelor-ad-media` (gives `botchelor-ad-media.b-cdn.net`).
   - Origin type: **Bunny Storage Zone** → `botchelor-ad`.
   - Pricing tier: **Standard**. Under Pricing & Routing, the Asia, South America, and Middle East and Africa regions
     cost 3 to 6 times more; switching them off is optional.
4. **Its hostname:** General → Hostnames → add `media.botchelor.com` (once its record is in, "4. DNS at Wix"), then
   **Enable** SSL → Add Free Let's Encrypt Certificate. Turn on Force SSL.
5. **Token Authentication:** Security → **Token Authentication** on. Copy the **URL Token Authentication Key**. Leave
   **Token IP Validation off** (it turns the zone's IPv6 off and breaks links when a phone changes network; the app
   doesn't sign IPs).
6. **Browser caching:** Caching → Browser Cache Expiration → **12 hours** (43,200 s, the life of a link), so a browser keeps a
   file for as long as its link is handed out. Leave the edge cache at its default; storage-to-CDN traffic is free.
7. **CORS** (the reel player preloads shots): Headers → **Add CORS headers** on, for `mp4, png, jpg, jpeg, webp`.
8. **Spend cap:** Limits → **Monthly bandwidth limit: 500 GB**. The zone stops serving past it, at most $5 of traffic.
   Raise it when subscribers need more.
9. **Keys into the keychain** (prompted, never echoed; the caps are recorded so the nightly scan sees them):

   ```sh
   ~/ai-stack/bin/secrets add botchelor MEDIA_BUNNY_KEY --cap "Bunny prepaid, auto-recharge off; pull zone 500 GB/month"
   ~/ai-stack/bin/secrets add botchelor MEDIA_BUNNY_TOKEN_KEY --cap "signs CDN links only; pull zone 500 GB/month"
   ```

## 2. Copy the media that's already stored

`scripts/media-to-bunny.mjs` copies every file the database points to (After Dark's pictures, clips and keyframes, and
the looks tiles) from the bucket to the storage zone, under the same keys. It checks each file against the hash its key
names, and Bunny checks each upload against the SHA-256 sent with it. It changes nothing in the database and deletes
nothing. Today that's about 120 MB (16 After Dark files and 130 tiles were copied to the bucket on 2026-10-21), which
counts against Neon's media project's network transfer (4.5 GB a month).

```sh
cd ~/Documents/Repos/botchelor
export DATABASE_URL="$(security find-generic-password -s vault/botchelor/DATABASE_URL -w)"
export MEDIA_S3_ENDPOINT=…  MEDIA_S3_BUCKET=botchelor-media   # as on Vercel
export MEDIA_S3_ACCESS_KEY_ID="$(security find-generic-password -s vault/botchelor/MEDIA_S3_ACCESS_KEY_ID -w)"
export MEDIA_S3_SECRET_ACCESS_KEY="$(security find-generic-password -s vault/botchelor/MEDIA_S3_SECRET_ACCESS_KEY -w)"
export MEDIA_BUNNY_ZONE=botchelor-ad MEDIA_BUNNY_REGION=ny
export MEDIA_BUNNY_KEY="$(security find-generic-password -s vault/botchelor/MEDIA_BUNNY_KEY -w)"
node scripts/media-to-bunny.mjs --dry-run   # what it would copy, and how much
node scripts/media-to-bunny.mjs             # copy; safe to stop and run again
node scripts/media-to-bunny.mjs --verify    # every file in Bunny hashes to its key
```

Run it once now, and **again right before switching** for whatever was made in between. Rows still only in Postgres need
nothing: both deployments read those from the database.

## 3. DigitalOcean App Platform

1. **Create the app:** Apps → Create App → GitHub → `smithdavedesign/botchelor`, branch `main`, autodeploy on. Source
   directory `/`. It's detected as Node.js (a Web Service).
2. **Build and run:**
   - Build command: `npm run build` (the buildpack runs `npm ci` first, from `package-lock.json`).
   - Run command: `npm start` (`next start`, which listens on the `PORT` App Platform sets).
   - HTTP port: `8080` (the default).
   - Node: the buildpack follows `package.json` `engines` (`>=20.9`). Check the build log names a version Next 16
     supports (22 or 24, like Vercel's).
3. **Health check:** HTTP, path `/api/health` (200 when the database answers, 503 when it doesn't). Initial delay 20 s,
   period 10 s, timeout 3 s, failure threshold 3.
4. **Size:** `apps-s-1vcpu-1gb-fixed`, 1 GiB, shared vCPU, **$10 a month**. Or `apps-s-1vcpu-1gb`, **$12**, if you want
   to add a second instance later (manual scaling). One instance. Region: **New York (`nyc`)**, next to Neon's us-east-1.
5. **Environment variables** (Settings → App-Level Environment Variables). Scope **"Run and build time"** for all of them:
   the routing and redirects are read when the app is built as well as when it runs. Mark secrets **Encrypt**.

   | Variable | Value |
   |---|---|
   | `AFTER_DARK_ONLY` | `1` |
   | `AFTER_DARK_ORIGIN` | `https://ad.botchelor.com` |
   | `SITE_URL` | `https://botchelor.com` (the show; the build fails without it) |
   | `DATABASE_URL` | the same as Vercel production's (encrypt) |
   | `SESSION_SECRET` | the same as Vercel production's (encrypt). It signs sessions and the hop's tokens, and seals After Dark's provider keys stored in the database, so it must match. |
   | `FRONTIER_PASSWORD` | the same as Vercel's (encrypt): the admin key, for the admin's own agents on `/api/mcp` |
   | `CRON_SECRET` | the same as Vercel's (encrypt): the eval job and `/api/health`'s detail |
   | `MEDIA_BUNNY_ZONE` | `botchelor-ad` |
   | `MEDIA_BUNNY_REGION` | `ny` |
   | `MEDIA_BUNNY_CDN_HOST` | `media.botchelor.com` |
   | `MEDIA_BUNNY_KEY` | from the keychain (encrypt) |
   | `MEDIA_BUNNY_TOKEN_KEY` | from the keychain (encrypt) |
   | `AD_EVAL_DAILY_USD`, `ADULT_TEXT_PROVIDERS` | only if they're set on Vercel (the eval's budget; the OpenRouter hosts After Dark may use) |
   | `REPLICATE_API_TOKEN` | only if Vercel has it rather than After Dark's settings page (encrypt): the media backup's key |

   After Dark's other provider keys (OpenRouter, Venice, fal, Hive, a saved Replicate key) live sealed in the database,
   so they come across by themselves with `DATABASE_URL` and `SESSION_SECRET`.

   **Never set** `ADULT_MODE` (the local Ollama mode is for the admin's own machine; the code also refuses it wherever
   `VERCEL` or `AFTER_DARK_ONLY=1` is set), `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GTM_ID` or the site-verification tokens (no Google on this
   host), or the `MEDIA_S3_*` settings (Bunny is After Dark's store; the bucket stays the show's).
   Email (`RESEND_API_KEY`) and push (`VAPID_*`) are optional; without them After Dark's notifications aren't emailed
   or pushed from this host.
6. **Domain:** Settings → Domains → Add domain → `ad.botchelor.com` → "You manage your domain". Copy the CNAME alias it
   shows (ending `ondigitalocean.app`) for "4. DNS at Wix".
7. **Spend:** App Platform has no hard cap; the instance is a fixed price and includes 100 GiB of outbound traffic
   (150 GiB on the $12 size), then $0.02 a GiB. Set a billing alert: Billing → Billing alerts → $15.
8. **Alerts (optional):** the app's Settings → Alerts → Deployment failed, and Restart count.

No API token is needed: everything here is in the dashboard.

## 4. DNS at Wix

botchelor.com's DNS is at Wix (nameservers `ns10`/`ns11.wixdns.net`). There are no CAA records, so DigitalOcean's and
Bunny's certificates can issue. Wix → Domains → botchelor.com → **Manage DNS Records** → the **CNAME** section → Add
record. The host box adds `.botchelor.com` itself, and the first CNAME save asks to confirm.

| Host | Type | Points to |
|---|---|---|
| `ad` | CNAME | the alias DigitalOcean showed (`<app>.ondigitalocean.app`) |
| `media` | CNAME | the pull zone's host, `botchelor-ad-media.b-cdn.net` |

Leave every other record alone (the Vercel A records and `www`, Resend's `send`, `rsend`, `resend._domainkey` and
`_dmarc`). Then finish the domain in DigitalOcean (it issues a certificate once the CNAME resolves; propagation can take
up to a few hours), and enable SSL on the pull zone's hostname in Bunny. Check from outside this Mac's resolver cache:
`dig +short CNAME ad.botchelor.com @1.1.1.1`.

## 5. Verify After Dark's host (the show still unchanged)

Identify every check as ours (`/admin/analytics` filters it out):

```sh
UA='botchelor-live-check/1.0 (Claude)'
curl -s  -A "$UA" https://ad.botchelor.com/api/health                 # {"ok":true}
curl -sI -A "$UA" https://ad.botchelor.com/ | grep -i '^location'       # https://botchelor.com/
curl -sI -A "$UA" https://ad.botchelor.com/api/episodes | grep -i '^location'  # https://botchelor.com/api/episodes
curl -s  -A "$UA" https://ad.botchelor.com/robots.txt                  # User-agent: * / Disallow: /
curl -sI -A "$UA" https://ad.botchelor.com/after-dark | grep -i 'x-robots-tag'  # noindex, nofollow
```

In a browser, signed in on botchelor.com as the admin:

1. Open `https://ad.botchelor.com/api/auth/carry?to=/after-dark`. It lands on After Dark's page, signed in.
2. Open a pair's scene. In the network tab, a picture or clip is a 302 to
   `https://media.botchelor.com/after-dark/…?token=HS256-…&expires=…`, and loads.
3. The same link with the `token` removed, or with `expires` changed, answers 403 from Bunny.
4. Write the next lines, make a picture, make a reel: the new files appear in the storage zone (Storage → Browse Files).
5. A page of the show linked from there (Watch, Characters) opens on botchelor.com.

## 6. Switch on

1. Run the copy once more (step 2), then `--verify`.
2. Vercel → botchelor → Settings → Environment Variables → `AFTER_DARK_ORIGIN` = `https://ad.botchelor.com`,
   **Production only**. Redeploy production (a variable change takes effect on the next deployment), and confirm the
   deployment is the latest `main`.
3. Check:

   ```sh
   curl -sI -A "$UA" https://botchelor.com/after-dark | grep -i '^location'       # https://ad.botchelor.com/after-dark
   curl -sI -A "$UA" https://botchelor.com/api/admin/after-dark | grep -i '^location'  # https://ad.botchelor.com/api/admin/after-dark
   curl -sI -A "$UA" https://botchelor.com/ ; curl -sI -A "$UA" https://botchelor.com/watch   # as before
   ```

   As the admin on botchelor.com: the 🌙 After Dark link points to `https://ad.botchelor.com/api/auth/carry?to=%2Fafter-dark`
   and opens After Dark signed in. Reels and the eval job run there.
4. Run the copy (step 2) one last time: anything made on botchelor.com in the minutes before the switch went live is
   only in the bucket.
5. Point the admin's own agents' MCP connection for After Dark's tools at `https://ad.botchelor.com/api/mcp` (same
   `x-frontier-key`).

## 7. Switch back

1. Vercel: remove `AFTER_DARK_ORIGIN` from Production and redeploy. Every redirect was a 307, so browsers haven't kept
   any; After Dark is back on botchelor.com at once.
2. Files made on After Dark's host while it was on are only in Bunny. Copy them back so the show's deployment finds them:

   ```sh
   node scripts/media-to-bunny.mjs --back            # Bunny → the bucket, only what the bucket lacks
   node scripts/media-to-bunny.mjs --back --verify   # by the hash stored with each file, without downloading
   ```

3. Leave the DigitalOcean app running for a while, or destroy it (Settings → Destroy). The DNS records can stay.

## Costs

| | What | About |
|---|---|---|
| Bunny storage | 100 GB, Standard, one region, $0.01/GB a month | $1 |
| Bunny CDN | 500 GB served in Europe and North America, $0.01/GB | $5 |
| | (Bunny's minimum is $1 a month) | **≈ $6 a month** |
| DigitalOcean | one `apps-s-1vcpu-1gb-fixed` ($10) or `apps-s-1vcpu-1gb` ($12), 100–150 GiB out included | **$10–12 a month** |
| | | **≈ $16–18 a month together** |

Today's media is about 0.12 GB, so Bunny is at its $1 minimum until subscribers arrive. Storage-to-CDN traffic and
Bunny's storage API (the copy script's downloads) are free.

## Not built yet

- **The UK block and age verification** themselves (above): they come with the age-check provider.
- **Signing out of the show doesn't sign out of After Dark's host** until the next way in from the show. A sign-out that
  also clears ad.botchelor.com's session (one more hop) belongs with the subscriber launch.
- **IP-locked links:** not used, on purpose (see `lib/object-store.ts` `bunnyToken`).
- **Moving the looks builder's After Dark tab** off the show, if David wants it (above).

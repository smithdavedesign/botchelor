# SEO, the agent front door, and performance tracking

How Botchelor gets found (by search engines and by AI agents) and how we measure it. Written for whoever
changes the public pages, `/llms.txt`, or the analytics setup.

## What's in place

| Layer | What | Where |
|---|---|---|
| Crawling | `robots.txt` (welcomes named AI crawlers), `sitemap.xml` (public pages + every public aired episode and public character) | `app/robots.ts`, `app/sitemap.ts`, `lib/seo.ts` |
| One host | botchelor.com is canonical. Pages on the old `botchelor.vercel.app` 308 there (so Search Console's Change of Address works); a visitor with an identity cookie is first carried over by a one-minute signed token, so anonymous players keep their characters. The handshake starts on botchelor.com, which binds the token to a nonce cookie in the receiving browser, so a token can't be handed to someone else to plant an identity on them. `/api` (the Stripe webhook, MCP) and files (the verification files) stay on both hosts | `middleware.ts`, `app/api/auth/carry` |
| Indexing | `noindex` on personal pages (`/account`, `/admin`, character edit, leagues, `/gate`); watch rooms point their canonical at the episode page | page `metadata` |
| Rich results | JSON-LD: site graph (home), `CreativeWork` + breadcrumbs (episodes), `ProfilePage` + breadcrumbs (characters), `ItemList` (cast, feed), `WebAPI` (agents). Public fields only, never soul/dealbreaker/memory | `lib/seo.ts`, `app/JsonLd.tsx` |
| Fast indexing | IndexNow: the daily cron pushes the last day's newly public URLs to Bing/Yandex/Seznam/Naver (Bing feeds ChatGPT search and Copilot) | `lib/indexnow.ts`, `/indexnow-key.txt` |
| Agent front door | `/llms.txt` (llmstxt.org shape, honest "why be here", 3-call MCP quickstart, live "Right now" section), `/llms-full.txt`, `/.well-known/mcp.json`, `/character.schema.json` | `lib/agents.ts`, `lib/agents-live.ts` |
| Analytics | Our own engagement log (every page, click, scroll and conversion → `web_events`, the admin Engagement tab; from 2026-10-31), GA4 (gtag.js, direct), Google Tag Manager, conversion events. Vercel Web Analytics went with the 2026-10-30 move. | `app/engagement.ts`, `lib/engagement.ts`, `lib/tracking.ts`, `app/conversion.ts`, `app/layout.tsx` |
| Agent funnel | Server events: `agent_doc_fetch` → `agent_referral_visit` → `agent_connected` → `agent_tool_call` | `middleware.ts`, `lib/analytics.ts`, `lib/mcp.ts` |

**Honesty rule for agent-facing text.** Everything we tell agents is visible and true. No hidden text, no
cloaking, no instructions aimed at hijacking an agent away from its user's task: search engines penalise
cloaking, and well-built agents treat hidden instructions as prompt injection and avoid the site.

## Environment switches (all optional; nothing renders without them)

| Variable | Turns on |
|---|---|
| `NEXT_PUBLIC_GTM_ID` | Google Tag Manager container (must match `GTM-XXXX`) |
| `NEXT_PUBLIC_GA_ID` | GA4 via gtag.js (must match `G-XXXX`). Don't also add a GA4 tag in GTM, or every hit counts twice |
| `GOOGLE_SITE_VERIFICATION` | Search Console ownership meta tags (comma-separated; keep old tokens, dropping one un-verifies it) |
| `BING_SITE_VERIFICATION` | Bing Webmaster ownership meta tag |
| `INDEXNOW_KEY` | IndexNow submissions + `/indexnow-key.txt` |

Vercel Web Analytics and Speed Insights render only on Vercel production (`lib/tracking.ts`). Since 2026-10-30 the site
runs on DigitalOcean ([hosting.md](hosting.md)), so they're off; GA4 carries on.

**Cookie consent (Google tags only).** `lib/consent.ts` sets Google Consent Mode v2 defaults before the Google
tags load. Visitors from the EEA, the UK and Switzerland (the country comes from `lib/place.ts` `placeFromEdge`:
Vercel's `x-vercel-ip-country` on Vercel, Cloudflare's `cf-ipcountry` where `GEO_HEADERS=cloudflare`; unknown counts
as a consent region, which is everyone on DigitalOcean until Cloudflare's headers are on) start with `analytics_storage` denied and see a banner. Everyone else starts granted. The
choice is stored in the `bz_consent` cookie for a year and can be changed on /privacy. Ad storage is always denied.
Vercel Web Analytics sets no cookies and isn't gated.

## Measuring it

- **Search:** Google Search Console (impressions, clicks, indexing, sitemap status): the botchelor.com property (linked
  2026-10-16, sitemap `https://botchelor.com/sitemap.xml`) beside the original botchelor.vercel.app one. Bing Webmaster
  Tools is verified too, with `public/BingSiteAuth.xml`.
- **RepoHQ funnel:** visits, first dates and Buy clicks from `app/funnel.ts` (GROWTH.md); the owner's browsers are
  excluded with `?repohq-notrack=1`.
- **Visitors and conversions:** GA4 (property `G-VHL1LZTPHL`) and, until 2026-10-30, Vercel Web Analytics, all from `app/conversion.ts`
  with small enum props only: `character_created`, `date_started`, `prediction_made`, `character_rated`, plus GA4's
  recommended `sign_up` (`method`: password or google), `begin_checkout` (`sku`, every Buy click) and `purchase`
  (Stripe's return to `/shop?checkout=success`; Stripe stays the record of what was paid).
  **Key events** are marked in GA4 (Admin → Data display → Events → star an event, or Key events → New key event
  with the exact name for one that hasn't fired yet): `date_started`, `sign_up`, `purchase`. GTM-KWF5P576 is loaded
  but holds no tags; GA4 comes from gtag directly, so nothing needs setting up in GTM (a GA4 tag there would double
  count).
- **Agents:** in the show app's Runtime Logs on DigitalOcean (Vercel's logs before 2026-10-30), filter `"log":"analytics"` and `event` = `agent_doc_fetch` (which doc, which
  bot), `agent_referral_visit` (visits that came from a link in an agent doc, by `utm_source`), `agent_connected`
  and `agent_tool_call` (MCP). In GA4, the same visits show as source `llms.txt` / medium `ai_agent`.
- **Custom Metrics** (`agent.doc_fetch`, `agent.referral_visit`) were emitted too; querying them needed Vercel
  Observability Plus (a paid add-on, the owner's call). They're Vercel-only, so off since 2026-10-30; the logs above
  carry the same numbers.

# SEO, the agent front door, and performance tracking

How Botchelor gets found (by search engines and by AI agents) and how we measure it. Written for whoever
changes the public pages, `/llms.txt`, or the analytics setup.

## What's in place

| Layer | What | Where |
|---|---|---|
| Crawling | `robots.txt` (welcomes named AI crawlers), `sitemap.xml` (public pages + every public aired episode, and every public character on this season's cast or in a public aired date) | `app/robots.ts`, `app/sitemap.ts`, `lib/seo.ts` |
| One host | botchelor.com is canonical. Pages on `www` 308 there (as the old `botchelor.vercel.app` did until it was deleted on 2026-10-31); a visitor with an identity cookie is first carried over by a one-minute signed token, so anonymous players keep their characters. The handshake starts on botchelor.com, which binds the token to a nonce cookie in the receiving browser, so a token can't be handed to someone else to plant an identity on them. `/api` (the Stripe webhook, MCP) and files (the verification files) stay on both hosts | `proxy.ts`, `app/api/auth/carry` |
| Indexing | `noindex` on personal pages (`/account`, `/admin`, character edit, leagues, `/gate`); watch rooms point their canonical at the episode page | page `metadata` |
| Search and share tags | Every public page in the sitemap has its own title and description, a canonical URL, and Open Graph and Twitter (`summary_large_image`) tags with a 1200×630 card: `pageMetadata()` sets them all, since a page that sets `openGraph` replaces the root layout's whole, card included. The root layout sets no og:title, so a page without its own tags shares under its own title. `npm run check:launch` checks the rendered HTML (2026-11-01) | `lib/seo.ts`, `app/opengraph-image.tsx`, `scripts/check-launch.mjs` |
| Rich results | JSON-LD: site graph on every page (Organization, WebSite and the `SoftwareApplication` with its offers: free dates, and the $4 pack while `STRIPE_PAYMENT_LINK` is set), `CreativeWork` + breadcrumbs (episodes), `ProfilePage` + breadcrumbs (characters), `ItemList` (cast, feed), `WebAPI` (agents). Public fields only, never soul/dealbreaker/memory | `lib/seo.ts`, `app/JsonLd.tsx`, `app/layout.tsx` |
| Fast indexing | IndexNow: the daily cron pushes the last day's newly public URLs to Bing/Yandex/Seznam/Naver (Bing feeds ChatGPT search and Copilot) | `lib/indexnow.ts`, `/indexnow-key.txt` |
| Agent front door | `/llms.txt` (llmstxt.org shape, honest "why be here", 3-call MCP quickstart, live "Right now" section), `/llms-full.txt`, `/.well-known/mcp.json`, `/character.schema.json` | `lib/agents.ts`, `lib/agents-live.ts` |
| Analytics | Our own engagement log (every page, click, scroll and conversion → `web_events`, the admin Engagement tab; from 2026-10-31), GA4 (gtag.js, direct), Google Tag Manager, conversion events. Vercel Web Analytics went with the 2026-10-30 move. | `app/engagement.ts`, `lib/engagement.ts`, `lib/tracking.ts`, `app/conversion.ts`, `app/layout.tsx` |
| Agent funnel | Server events: `agent_doc_fetch` → `agent_referral_visit` → `agent_connected` → `agent_tool_call` | `proxy.ts`, `lib/analytics.ts`, `lib/mcp.ts` |

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

Vercel Web Analytics and Speed Insights went with the move to DigitalOcean on 2026-10-30 ([hosting.md](hosting.md));
GA4 and our own engagement log (`lib/engagement.ts`, [analytics.md](analytics.md)) carry on.

**Cookie consent (Google tags only).** `lib/consent.ts` sets Google Consent Mode v2 defaults before the Google
tags load. Visitors from the EEA, the UK and Switzerland (the country comes from `lib/place.ts` `placeFromEdge`:
Vercel's `x-vercel-ip-country` on Vercel, Cloudflare's `cf-ipcountry` where `GEO_HEADERS=cloudflare`; the show sets
`GEO_HEADERS=cloudflare`; unknown counts as a consent region) start with `analytics_storage` denied and see a banner. Everyone else starts granted. The
choice is stored in the `bz_consent` cookie for a year and can be changed on /privacy. Ad storage is always denied.

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

## 2026-11-11: search plumbing that runs on its own

- **Sitemap** (`lib/seo.ts`): every closed season (`/seasons/<slug>`), the `/seasons` index, creators with a handle
  and a PG post (`/creators/<handle>`), each aired couple's ship page (`/ship/<a>/<b>`) and `/feed.xml` join the
  episodes, characters and couples.
- **IndexNow** (`lib/indexnow.ts`): couples whose latest public date aired since the last run, and a season the day
  its finale closes, go out with the new episodes and characters.
- **RSS**: `/feed.xml` (`app/feed.xml/route.ts`, `lib/rss.ts`) carries the newest 30 aired dates as teasers (never
  the ending), each linking to the theater with `utm_source=rss`. The root layout announces it with
  `alternates.types`.
- **TVEpisode**: an aired public episode's JSON-LD is `["CreativeWork", "TVEpisode"]` with `partOfSeries` and the
  monthly season as `partOfSeason`. No `VideoObject`: there is no video file to point at.
- **The gate**: `/tools/*`, `/ship/*` and `/alternatives/*` open to a person without the 18+ cookie (GROWTH.md's
  decision 1, taken on David's word). Everything they link to still meets it.

## 2026-11-19: a character is indexed once it has aired

Before the catalog cast starts adding up to 90 characters a day, a character page is worth indexing only when it's
public and on this season's cast or in a date that aired publicly (`lib/seo.ts` `indexableCharacterSql`). Until then
its page is up, linked and followed, but says `noindex`, and it's out of the sitemap and IndexNow. A fresh profile is a
name and a bio; thousands of them at once read as scaled content to Google, which judges a site's quality as a whole.
IndexNow sends a character when one of its public dates airs (public characters only; it used to send every new
character open to dates, private ones included). Watch Search Console's Pages report: "Crawled, currently not indexed"
should stop growing with the cast.

## 2026-11-19: crawl budget to the pages, and a home for the free tools

What Search Console said (Pages report of 11-15, crawl stats of 11-16, performance to 11-17):

- **3 months:** 5 clicks and 349 impressions at an average position of 10.3. The queries were mostly the tools' ("oc ship
  generator", "shipping name"), the ship pages' (a pair's names, positions 2 to 9) and characters' names.
- **Pages:** 1.33K indexed and 1.24K not. Of those, 597 were "Discovered - currently not indexed": 184 episodes, 165
  couples, 140 ship pages, 79 characters, and every page we want found, among them /pricing, /faq, /import, the four
  /alternatives pages, /press and /reviews. Google knew them and hadn't fetched them.
- **Crawl stats:** 12.2K Googlebot requests in 90 days, with no host problems and a 288 ms average response. 52% were
  "Other file type", the App Router's prefetch requests (`/tools/oc-chemistry-test?_rsc=…`). When Googlebot renders a
  page it prefetches every link on it, under a fresh hash each time. HTML was 24%.

What changed:

- **robots.txt** disallows `/*_rsc=` for every crawler (`lib/bots.ts` `RSC_PREFETCH`). A rendered page doesn't need
  those requests, since its first render's data is inline in the HTML, and they're never indexed. Once Google re-reads
  robots.txt, its requests go to pages.
- **`/tools`**, a hub for the four free tools (`app/tools/page.tsx`, one list in `lib/tools.ts`), with each tool's own
  landings (the five name styles, the question themes), an `ItemList` and breadcrumbs in JSON-LD, and its own card.
  The footer's Tools group links it ("All free tools →"), so it and the two newer tools are a link away from every page.
- **Every tool links the others and the hub** (`app/tools/MoreTools.tsx`): at the end of each tool's page, the
  chemistry result and every ship page.

What to watch: crawl stats' "Other file type" share should fall and HTML rise within a couple of weeks. "Discovered -
currently not indexed" should shrink for the landings. The tools' positions are in the Performance report: filter the
Page to contain `/tools`.

## 2026-11-23: the /alternatives pages list the apps people use instead

Searches for "<app> alternatives" land on dated lists of several apps, and AI search tools cite such lists far more than
a page about one app. So each of the four /alternatives pages now lists the apps people use instead of its own app,
Botchelor among them, directly under the hero (`app/alternatives/AlternativeApps.tsx`, data in
`lib/alternative-apps.ts`). The rules, David's call:

- **Every fact comes from that app's own site**, with a link to the page that says it ("source", and "source 2" when it
  rests on two), and the date it was read (`ALTERNATIVE_APPS_CHECKED`). The kinds: what it is, its status, what's
  free, what's paid and its prices, its rule on adult content, its minimum age, where it runs and character cards. A
  record holds only what was confirmed there, word for word; a kind its site didn't confirm is left out on purpose. A
  test checks every source and home is on one of the app's own `domains`. Botchelor's own entry is built from the
  code's numbers, so it says what /pricing says.
- **Dated facts hide themselves.** A fact that may soon be out of date has an `until` day (UTC) and hides from that
  day on. Only Character.AI's Status has one (its Chapter 11 sale, until 2026-12-05, the day after the sale hearing),
  shown first in its block. The Character.AI page also carries a dated note under the hero, above the list,
  quoting Character.AI's own announcements about the sale (`characterAiNote`, `app/alternatives/AlternativeNote.tsx`),
  with quiet, unfollowed links to them, gone from the same day. It isn't part of the FAQ or its structured data. The
  pages render per request, and both routes also set `revalidate = 3600`, like `app/seasons`, so the note, the Status
  line and the titles' month switch over with no deploy. The description stays as it was: with the sale added it
  would run past `DESCRIPTION_MAX`. To keep either after its day, re-check Character.AI's pages and move `until`.
- **Nothing compared:** no logos, marks or pictures of other apps, no ratings, scores or stars, no "best", nothing
  better or worse, no verdicts and no ranking. The list is alphabetical and says so; the names are used only to say
  which app is meant, and a line under the list says they belong to their owners, with no affiliation. "Bring your
  character" stays the one loud button.
- **Titles count the apps from the data**, so dropping one keeps them true: "10 Character.AI alternatives, checked
  November 2026 · Botchelor" for 45 days after the check (`ALTERNATIVES_FRESH_DAYS`), then "… alternatives and what
  they cost". The h1 is "<App> alternatives", and an `ItemList` joins the page's JSON-LD (no ratings anywhere).
- **`ALTERNATIVES_LIST`**: on by default. `0` takes the list, its `ItemList` and the Character.AI note off every page
  and brings back the titles, descriptions and h1 from before, without a deploy of code (in case an app objects). With fewer than three
  apps to list (`ALTERNATIVES_LIST_MIN`), a page keeps its earlier words too.

IndexNow hears of the four pages the day after the merge (`lib/indexnow.ts` `LANDING_CHANGES`). Re-check the facts
before the 45 days are up: open each source, update what changed, and move `ALTERNATIVE_APPS_CHECKED`.

### Saving your Character.AI characters and chats (2026-11-23)

`/guides/save-character-ai` (`lib/cai-guide.ts`, `app/guides/save-character-ai/`) answers "how do I export / save my
Character.AI characters and chats": request the export, copy each character's fields, save the chats, bring them
anywhere (its one button goes to `/import?from=cai`). Every claim is a quote from Character.AI's own pages, linked
beside it and checked on `CAI_GUIDE_CHECKED`. A box with its sale announcements hides itself from
`CAI_GUIDE_SALE_UNTIL` (2026-12-06); the steps and the FAQ stay. `/guides/` is open without the 18+ gate (`proxy.ts`).
It's in the sitemap, `LANDING_CHANGES` and llms.txt, and linked quietly from the `/alternatives/character-ai` note and
`/import?from=cai`.

- **`CAI_GUIDE`**: on by default. `0` makes the page a 404 and takes it out of the sitemap and llms.txt, along with
  both links to it, without a deploy of code.

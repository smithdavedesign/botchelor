# Launch ready: Botchelor (2026-11-01)

Botchelor was already live on https://botchelor.com with most launch basics in place: robots.txt, a sitemap, a share
card, terms, privacy, a Buy button and RepoHQ's beacon. This pass completes them and makes each one checkable, without
changing what the show does. Nobody was available to ask, so the decisions are written down below.

## What changed

### 1. Search and sharing
- **Every public page has its own tags.** That's the 24 pages in the sitemap's static part, plus `/legal`. Each gets
  `pageMetadata()` in `lib/seo.ts`, which sets:
  - its own `<title>` and meta description;
  - a canonical URL;
  - Open Graph tags (title, description, url, type, site name) with a 1200×630 image;
  - a `summary_large_image` Twitter card.

  Pages that draw their own card keep it: `/graph`, the ship name generator and the chemistry test.
- **Fixed: missing share images.** `/prompts`, couple pages and watch rooms set their own `openGraph` without an image.
  Next then drops the site card entirely (it replaces the root layout's `openGraph` whole). They name the card now.
- **Fixed: borrowed titles.** The root layout no longer sets og:title or twitter:title. A page that doesn't set its own
  now shares under its own title, not the home page's.
- **JSON-LD on every page of the show.** It's in the root layout, but not on After Dark's own host. It has
  Organization, WebSite and a **SoftwareApplication** with two offers:
  - 3 free dates a week ($0);
  - "5 more dates" for **$4.00, paid once**, listed while `STRIPE_PAYMENT_LINK` is set.
- **robots.txt** (`app/robots.ts`):
  - allows indexing and names the sitemap;
  - now lets crawlers fetch `/api/og/`, where the episode and chemistry-test share cards live (Twitterbot obeys
    robots.txt);
  - renders per request, so its sitemap address is always the running site's `SITE_URL`.
- **sitemap.xml** (`app/sitemap.ts`) now also lists `/safety`, `/agents/pricing` and `/showcase`.
- **The share image** is `app/opengraph-image.tsx`, drawn with code at build time. Nothing is copied from the web.

### 2. Privacy and terms
- **Pages and footer:** `/privacy` and `/terms` already existed, and `/legal` has both on one page. The footer links
  them under "Help and legal" as "Terms and refunds" and "Privacy".
- **Privacy, Analytics section:**
  - names the beacon's three events: `visit`, `activate` and `checkout`;
  - says it sets no cookies;
  - says the referring site is sent only when it's another site.
- **Privacy, what's collected:** cookies (identity, session, 18+ confirmation, consent choice) and everything else
  stored are listed under "What we store", unchanged.
- **Terms:**
  - "No warranties" (the service is "as is") is unchanged;
  - the price is now stated: "It costs $4 once", not a subscription;
  - the refund line is unchanged: within 14 days, in full, with your Stripe receipt.
- **Dated 1 November 2026**, with a "Changed:" line, as the notice promises when it changes. The content policy, 2257
  and cancel pages keep their 24 October date; they didn't change.
- **Contact:** the email (`CONTACT_EMAIL`), the report form, and now the "Give us feedback" button on every page.

### 3. Payment
- **Hidden without a link.** The shop's Buy button ("Buy 5 more dates for $4") isn't shown at all while neither
  `STRIPE_PAYMENT_LINK` nor `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` is set; the shop says "Purchases open soon". Before, it was
  shown disabled.
- **With a link set,** clicking Buy asks `/api/checkout`, which answers with the link plus an order reference, so the
  webhook knows whose dates to add. The link is never in the page and never in the code.
- **Unchanged:** buying needs an account wherever accounts are on.

### 4. Visit beacon (RepoHQ)
- **Already built** (`app/funnel.ts`, mounted on every page by `app/FunnelBeacon.tsx`). It POSTs
  `{"slug":"botchelor","kind":…,"referrer":…}` to `https://idea-factory.1426davejobs.workers.dev/api/ideas/signal`:
  - fire-and-forget, `keepalive`, `credentials: "omit"` (no cookies);
  - a JSON body sent as text/plain, so there's no CORS preflight;
  - with the existing extra `path` field, and `ref` on a share link's visit;
  - `referrer` is `document.referrer` only when its origin isn't ours, else `null`.
- **`visit`:** once per browser session (sessionStorage), on every page.
- **`activate`:** the first time a browser uses **the core action, starting a date** (sending a character on a blind
  date). Once per browser (localStorage). It now also counts a date started from a character's page or a couple's
  page, not only from `/create`.
- **`checkout`:** every click on Buy, now counted on the click itself. Before, the required 18+ checkbox stopped the
  form's submit, so a click without it went uncounted.
- **Production only:** sent when `NEXT_PUBLIC_DEPLOY_ENV`, else `NEXT_PUBLIC_VERCEL_ENV`, is `production`
  (`isProductionBuild`).
- **Never sent:**
  - when `navigator.webdriver` is true;
  - when localStorage `repohq:notrack` is set (or after opening any page with `?repohq-notrack=1`);
  - when the visitor declined analytics cookies.

### 5. Deployment
- **`.provision`** at the root: `vercel project botchelor` and the request for the $4 Stripe payment link.
- **Hosting note:** botchelor.com runs on DigitalOcean App Platform since 2026-10-30 (`docs/hosting.md`), and its live
  `STRIPE_PAYMENT_LINK` is already set there (REVENUE.md). The Vercel project is the host `.provision` prepares.

### 6. Tests
- **New: `tests/launch-ready.test.ts`** (21 tests):
  - every page in the sitemap has a title and description no other page has, a canonical URL equal to its path, Open
    Graph with a url and a 1200×630 card (or its own card file), and a large Twitter card;
  - the JSON-LD offers $4 once with a link set, and only the free dates without one;
  - robots.txt and the sitemap exist, and the sitemap still lists the public pages with the database down;
  - the Buy button is hidden without the env var and shown with either variable, and the link never appears in the page;
  - the privacy page names the three events, and the terms carry the price, the refund and the disclaimer;
  - the beacon's body, `keepalive`, no cookies, the once-rules, the referrer, and every "send nothing" case;
  - the production rule.
- **Updated:** `tests/pages.test.ts` (the sitemap list; the Buy button has no `disabled` state any more) and
  `tests/legal-pages.test.ts` (the new date).

### 7. Screenshots
- **The run:** `npm run screenshots` (`scripts/screenshots.mjs`, playwright-core is a devDependency).
  1. Builds the app (`-- --skip-build` reuses `.next`).
  2. Starts `next start` on loopback with a throwaway PGlite, the stand-in showrunner and
     `STRIPE_PAYMENT_LINK=https://example.com/pay`.
  3. Drives Chromium from `CHROMIUM_PATH` (it never downloads a browser) and saves six viewport-only PNGs at 1280×800
     and on an iPhone 13.
  4. Stops the app.
- **What they show:** `home-*` is the start page. `date-*` is the core action: Tamsin Holloway, a sample character, on
  a date with the house character Juniper Vale, playing in the theater. `shop-*` is the Buy button.
- **The phone shop shot:** on a phone the footer is about 1,000px below the Buy button, so `shop-mobile` shows the Buy
  card. `shop-desktop` shows the Buy button and the footer's Terms and Privacy links together.
- **Rendering:** a □ in the nav's date counter and the theater's controls is a glyph the sandbox's fonts lack, not the
  site.
- **The old run:** the previous long capture is still there, as `npm run screenshots:season` (`--season`).
- **Not in `npm test`:** neither the screenshot run nor the check below is.

### 8. A launch check on the real build
- **`npm run check:launch`** (`scripts/check-launch.mjs`) builds and starts the app, then reads its sitemap. For every
  public page it checks the rendered title, description, canonical, Open Graph and Twitter tags, the JSON-LD's $4
  offer, and the footer links. It also checks:
  - that each share image is a real 1200×630 PNG;
  - robots.txt;
  - the Buy button with a link set, and its absence without one (on a second start).
- **Last run:** passed on 24 public pages and 4 share images.

## Decisions (nobody to ask)
- **Contact isn't GitHub issues.** The repository is private (BUILD.md), so a link to its issues would be a 404 for
  visitors. The legal pages offer the "Give us feedback" button (every page; the owner reads it on `/admin/feedback`),
  the report form and the contact email. If the repo goes public, add the issues link next to `FEEDBACK_NOTE` in
  `app/legal/sections.tsx`.
- **The production rule's fallback.** When the build sets neither `NEXT_PUBLIC_DEPLOY_ENV` nor `NEXT_PUBLIC_VERCEL_ENV`,
  the beacon goes by the server's `DEPLOY_ENV`. The live site on DigitalOcean sets only `DEPLOY_ENV=production`, so the
  strict rule would have stopped counting real visitors.
- **The $4 offer follows the link.** It's in the JSON-LD only while a payment link is set, just like the Buy button:
  search results never advertise something that can't be bought.
- **Hidden, not disabled,** while there's no link, so nobody meets a button that does nothing.
- **One screenshot script, two runs.** `scripts/screenshots.mjs` already existed, as a ~40-picture season capture.
  Rather than lose it, the launch proof became its default and the season run moved behind `--season`.
- **The shop as the third subject.** The six PNGs are the start page, the core action and the shop. The shop is where
  the Buy button and the footer links can be shown together; the date's own page has neither.
- **Old README pictures kept, not deleted.** README's Screenshots section now holds only the six launch pictures. What
  was there (the 23–31 October changes) moved, unchanged, to the next section, "What's new before launch".
- **Small fixes found on the way:**
  - the stand-in showrunner (`scripts/screenshots.mjs`, `scripts/harness.mjs`) read a prompt field the app had renamed,
    so every line of a sample date was the same sentence;
  - `/api/og/` was closed to crawlers;
  - three pages had no share image.

## How to check it
```bash
npm test                 # vitest; tests/launch-ready.test.ts is this pass
npm run typecheck
npm run check:launch     # the production build, as a crawler sees it
npm run screenshots      # needs CHROMIUM_PATH; rewrites the six PNGs in docs/screenshots/
```
On the live site:
- **Files:** `https://botchelor.com/robots.txt` and `/sitemap.xml`.
- **Tags:** view the source of any page for its title, description, canonical, og:* and twitter:* tags and the
  `application/ld+json` block. Google's Rich Results Test should find the SoftwareApplication with its offers.
- **The beacon:** open the site in a normal browser with the network panel on. Expect one `signal` request with
  `kind: "visit"` per session, `activate` on your first date, and `checkout` on each Buy click. Your own browser is
  skipped once you've opened `?repohq-notrack=1`, so check from a private window.

## What's left for David
1. **The Stripe payment link → `STRIPE_PAYMENT_LINK`.**
   - When the broker hands you the $4 link, paste it into the Vercel project's env as `STRIPE_PAYMENT_LINK`
     (Production), with `STRIPE_WEBHOOK_SECRET` from that link's webhook (`checkout.session.completed` →
     `https://<host>/api/webhooks/stripe`), then redeploy. `/shop` then shows "Buy 5 more dates for $4".
   - botchelor.com itself runs on DigitalOcean, where the live link is already set. Nothing to do there unless the link
     changes.
2. **A custom domain, if you want one.** botchelor.com is already the site's domain (DNS at Cloudflare → DigitalOcean).
   Only point it at Vercel if Vercel should serve it instead.
3. **Optional:** make the GitHub repo public if you'd like issues as a contact route, then add the link (see Decisions).

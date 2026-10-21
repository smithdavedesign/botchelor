# Growth: what RepoHQ measures for Botchelor

RepoHQ's growth loop (idea-factory `lib/growth.js`, RepoHQ `docs/growth-loop-prd.md`) reads three events from the
funnel beacon in `app/funnel.ts`:

| Event | Fires when | Where |
|---|---|---|
| `visit` | any page opens, once per browser session | `app/FunnelBeacon.tsx` (root layout) |
| `activate` | **the core action: starting a date**, the first time a browser does it | `trackConversion("date_started")` in `app/conversion.ts` |
| `checkout` | someone clicks Buy in the shop (intent, not a payment) | `app/shop/BuyButton.tsx` |

Not sent from previews or local runs, automated browsers, browsers marked as the owner's (open any page once with
`?repohq-notrack=1`), or visitors who declined analytics cookies. The privacy page names all three.

## 2026-10-20: a free OC ship name generator

**Mission.** Build a free OC ship name generator. "Ship name generator" is a search with live demand (one
single-purpose tool gets about 3K visits a month, per indexator.ai), and nothing that ranks for it links shipping to
OCs. Each result is a shareable `/ship/<a>/<b>` page that ends in "send them on a blind date", one click from
`/create`. The playbook's rule applies: under 50 visitors a week, a mission brings visitors (an SEO page) rather than
changing the landing page or the price.

**The number.** 40 unique visitors a week now (RepoHQ's `visit`). The target is 50 a week within 14 days of the merge.

**What changed, and why**
- **`/tools/ship-name-generator`**, the page for the search. It has an "OC Ship Name Generator" heading, two name
  inputs, how a ship name is made, and a closing line pointing OC owners at the show. It has its own title,
  description, canonical link and share card, it's in `sitemap.xml`, and it's linked from every page's footer so
  crawlers find it from the rest of the site.
- **`/ship/<a>/<b>`**, the result. The form is a plain GET to `/ship`, which 303s to `/ship/juniper/dex` (a relative
  `Location`, so the visitor keeps their host and cookies). The page server-renders up to 10 ship names, best first,
  each with the two pieces it came from, plus a copyable link, a form for another pair, and "Send them on a blind
  date". That button goes to `/create?name=Juniper`, which now opens the builder with the name already in. Each
  pair has its own canonical address, an og:title with both names and the top blends, and a share card.
- **The generator** (`lib/ship-names.ts`) is pure and deterministic: no model, no randomness, no database. It works
  with every LLM variable unset, and a link shows everyone the same names. A blend is the start of one name and the
  end of the other, both ways round, and each side keeps at least 2 letters. Blends that read like a name rank
  first: a shared letter at the seam (Draco + Harry → Drarry), a consonant meeting a vowel, no pile-ups, a fair share
  of both names.
- **Safety.** The show's own filter (`lib/safety.ts`) reads both names, and the pair together, so "Taylor" + "Swift"
  is refused. A well-known real person, or a sexual or underage term, gets an error, no ship names, and `noindex`.
  So do unreadable names (digits, one letter, over 24 characters). A refused name is never echoed in the page, its
  title or its share card. Every generated blend passes the same filter, so Selene + Roxy never offers "Sexy".
- **The beacon now says which page.** Every event carries a `path` (`beaconPath` in `app/funnel.ts`). On the 18+
  gate, that's the page the visitor was headed to, so a search visitor who meets the gate first still counts for the
  tool. A ship page counts as `/ship`, because its address holds names someone typed and nothing typed goes to the
  beacon. The privacy page says so.

**How it's measured**
- **The headline:** unique `visit`s a week on RepoHQ, as before. Success is 50 a week or more within 14 days of the
  merge.
- **Attribution:** `visit`s with `path` `/tools/ship-name-generator` (search arrivals) and `/ship` (shared results),
  with their referrers (google.com, bing.com, social sites). If the week reaches 50 but these paths add little, the
  rise came from somewhere else.
- **Downstream:** `activate` (a first date) can't be tied to a visitor without cookies. The read is whether
  activations rise alongside `/tools` and `/ship` visits.
- **Caveats:**
  - If RepoHQ ignores the new `path` field, attribution falls back to referrers and the total.
  - Ranking for a new page can take longer than 14 days. If the window closes with impressions in Search Console
    but few clicks, read it as "not yet", not "no".

**Decisions made without asking** (no one to ask; recorded here):
1. **The 18+ gate stays on these pages.** The show is 18+ by David's call, and exempting pages is a legal-posture
   decision, not a growth one. Crawlers already pass the gate, and a person's visit is counted on the gate with the
   tool's path. If the gate's bounce turns out to eat the search traffic, exempting `/tools` and `/ship` is the
   experiment to propose next.
2. **The button sends the first name only.** On the website a person's two characters can't match each other (the
   swipe deck leaves your own out), so the copy promises a blind date for Juniper, not a date between Juniper and Dex.
3. **Two-word names blend from the first word**, the way ship names come from first names.
4. **At most 10 names.** The best 5 always show, and past that only blends that read well.
5. **No new dependency, and nothing to provision** (no `.provision` line). Checkout, Stripe and prices are untouched.
6. **Step 0 (gstack):**
   - It reuses what was there: the content filter, `ShareLink`, the funnel beacon, the sitemap's `PUBLIC_PATHS`, the
     share-card pattern and the e2e harness.
   - It's more than 8 files, but each is small: one library, two pages, the redirect, a shared form, a shared share
     card, and two share-card routes.
   - The web search check wasn't run. Everything here is a Next built-in (route handler, metadata,
     `opengraph-image`) or existing code.

**Self-review** against gstack's checklist:
- **Pass 1 (CRITICAL):** nothing found.
  - No SQL and no database writes.
  - No `dangerouslySetInnerHTML`; names are rendered as React text.
  - No open redirect: the `Location` is always `/ship/…` with encoded segments, or the tool.
  - No model output anywhere.
  - The new `ShipError` values are all covered by a `Record`, and the beacon's kinds are unchanged.
- **Pass 2:** two fixes. The redirect was absolute and lost the host on `next start`, so it's now relative. Short
  inputs let weak blends ("Drry") reach the list, so there's now a score floor past the first five.

**Proof**
- `tests/ship-name-generator.test.ts` covers all five acceptance criteria, plus the generator, `/create`'s prefill,
  the share cards and the beacon's path.
- `tests/zz-ship-preview.test.ts` checks the generator over every pair of house-cast first names.
- `npm run screenshots:ship` runs the same checks over HTTP against the production build, then captures the six
  README screenshots.

## 2026-10-21: the episode share card, a link that unfurls as a prediction poll

**Mission.** Episode pages had a bare "Copy link", and the audience lives on Reddit and Discord, where a link's preview
decides whether anyone clicks. Each episode now has its own share image asking "How does it end? A second date, just
friends or a disaster". That turns a shared episode into the spectator invite the PRD's share loop counts on ("each
shared episode brings at least 1 new spectator"). A `?ref=share` tag tells those visits apart from "direct". This
follows the playbook's rule: under 50 visitors a week, a mission brings visitors and doesn't touch the landing page or
the price.

**The number.** 43 unique visitors a week now (RepoHQ's `visit`; 42 of them "direct"). The target is 50 a week within
14 days of the merge.

**What changed, and why**
- **The card: `GET /api/og/episode/<id>`** (`app/api/og/episode/[id]/route.tsx`), a 1200×630 PNG. It shows the two
  characters (portrait or tile), where they met, "How does it end?" and the three endings as poll options. The footer
  says a right guess earns 10 points, or after the finale, "make your guess, then watch how it went". It's drawn from
  what a logged-out spectator may see, so it never has the ending before the finale airs. It never marks the ending
  afterwards either, and it never names a creator. An unknown, private or hidden (reported) episode is a 404.
- **The page's tags.** `generateMetadata` points og:image and twitter:image at the card, with twitter:card
  `summary_large_image` and an og:title that asks the question. The description (`shareDescription` in
  `lib/episode-share.ts`) is "<A> meets <B>. <the setting, cut to fit> Guess how it ends before the finale airs, for
  free points." It never lists the endings and always keeps the invitation within 200 characters. Setting
  `openGraph.images` in `generateMetadata` is what puts the new card ahead of the old `./opengraph-image` (Next 16.4
  only adds a file-based image when the page sets none).
- **Share links** (`app/episodes/[id]/EpisodeShare.tsx`), wherever the page had "Copy link": the poll, the finale's
  "Share it anyway" and the creator's own card. Copy link, "Share on Reddit" (reddit.com/submit with the link and
  "<A> × <B> went on an AI blind date. How does it end?") and "Share on Bluesky" (bsky.app/intent/compose). All three
  share `/episodes/<id>?ref=share`. A date its host took offline still offers none.
- **The beacon counts the tag.** A `visit` now carries `ref: "share"` when the page was opened with `?ref=share`
  (`beaconRef` in `app/funnel.ts`). On the 18+ gate it reads the tag from the page the visitor was headed to, the way
  `path` already did. Only known tags are sent (`BEACON_REFS`, just `share`), so nothing typed into an address reaches
  the beacon. `activate` and `checkout` are unchanged. The privacy page says so.
- **"Make your own character"**, a button to `/create` right under the episode's title, for anyone who isn't one of
  that date's creators: "Send your OC on a blind date like this one. Free to start, no sign-up." It sits above the
  badges so it stays in a phone's first screen. Measured on an iPhone 13, it ends 106px above the fold, with long
  names too.
- **Bluesky's card fetcher passes the 18+ gate.** `Bluesky Cardyb` has no "bot" token, so it was treated as a person
  and would have unfurled the gate. `lib/bots.ts` now knows it, beside redditbot and Discordbot.

**How it's measured**
- **The headline:** unique `visit`s a week on RepoHQ, as before. Success is 50 or more a week within 14 days of the
  merge.
- **Attribution:** `visit`s with `ref` = `share` are the visits shared links brought, with their referrers
  (reddit.com, discord.com, bsky.app) and `path` `/episodes/<id>`. If the week reaches 50 but few visits carry
  `ref=share`, the rise came from somewhere else.
- **Caveats:**
  - If RepoHQ ignores the new `ref` field, fall back to `visit`s whose `path` starts with `/episodes/` and whose
    referrer is a social site.
  - A visit counts once per browser session, so someone who already browsed the site and then opens a shared link
    isn't counted again. That's the same rule as every other visit.
  - Reddit and Discord show a preview only when someone posts the link. The card can't create shares; it makes each
    one more likely to be clicked. Nothing here posts anything for anyone.

**Decisions made without asking** (no one to ask; recorded here):
1. **A new route, and the old card stays.** `./opengraph-image` (the box score card) is still served and tested, and
   the JSON-LD image still points at it. Only the page's og:image moved to the poll.
2. **The card never gives the ending away, even after the finale airs.** A preview is seen by people who haven't
   watched, and "How does it end?" only works unanswered.
3. **The card never names a creator, even after both agree to the reveal.** The characters are the headline, and that
   rules out a leak by construction. The tests check the card and every tag, with no consent and with one of two.
4. **The button shows to everyone who isn't this date's creator**, signed in or not, not only to someone arriving from
   a share link. Someone who already has characters can ignore it. Showing it to creators of their own date would be
   noise.
5. **The share links use the site's address** (`siteUrl`), so a preview deployment never gets shared. Copy link keeps
   the address the page is on, as `ShareLink` always did.
6. **The card can be cached for an hour at the edge** (`s-maxage=3600`, a day stale-while-revalidate). Every unfurl
   reads the episode and up to two portraits from Postgres, and the 2026-10-20 outage was database transfer. The card
   only changes when the finale airs (its footer) or a portrait is approved.
7. **No new dependency, and nothing to provision** (no `.provision` line). Checkout, Stripe and prices are untouched.
8. **Step 0 (gstack):**
   - It reuses what was there: the spectator view (`getEpisodeView` with no viewer, which already hides the ending
     and the creators), `next/og`, `ShareLink`, the beacon, the bot list and the screenshot harness.
   - It touches 9 app files, one over the guideline's 8 (plus the screenshot script, package.json, the test and the
     docs). Each change is small: one route, one helper module, one share component, the page, its actions, the
     beacon, the bot list, one privacy sentence and CSS. There's one new route and no new service.
   - The web search check wasn't run. Everything is a Next built-in (route handler, `ImageResponse`, `generateMetadata`)
     or existing code. The one framework question (does a file-based `opengraph-image` override `openGraph.images`?)
     was answered from Next 16.4's own source (`metadata-resolution-primitives.js`). The production build confirmed it:
     exactly one og:image, the new card.

**Self-review** against gstack's checklist:
- **Pass 1 (CRITICAL):** nothing found.
  - The route only reads, through the existing parameterized query.
  - Nothing goes through `dangerouslySetInnerHTML`, and share URLs are percent-encoded onto fixed https hosts.
  - The model-written setting was already in the description; Satori draws it as text.
  - The new `ref` value has one consumer (the beacon), behind an allowlist. The new bot name ("Bluesky") is used
    nowhere else.
- **Pass 2:** two fixes.
  - `BEACON_REFS` repeated the `"share"` literal, so it now uses `SHARE_REF`.
  - The share helpers' edge cases gained a test: an empty setting while filming, `%20` rather than `+` in share URLs.
- **Found in the screenshots:** on a phone the button first sat under the badge line, only 33px above the fold, so
  one more line of badges would have pushed it out. It moved up under the title (now 106px), and the run checks long
  names too.

**Proof**
- `tests/episode-share-card.test.ts` covers all five acceptance criteria. That's 30 tests: the card's PNG, size, 404s,
  wording and no-spoiler rule; the tags for every ending; creator privacy; the share links on every branch of the
  page; and the beacon's `ref`, the gate and the button. `npm test` passes in full.
- `npm run screenshots:share` runs the same checks over HTTP against the production build, as Reddit's, Discord's and
  Bluesky's fetchers. Then it captures the six README screenshots and checks in a real browser that the button is in
  the first screen (also with long names) and that every share link carries `?ref=share`.

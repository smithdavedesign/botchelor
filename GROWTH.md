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

## 2026-10-22: the OC chemistry test, "will these two make it?"

**Mission.** Writers search for character chemistry tests and OC relationship generators (Jenova, Taskade and
Headcanon Generator all target that search). Botchelor already had the inputs (three traits, a want, a dealbreaker)
and a rules engine that decides second date, friends or disaster. Offered as a free test, the engine becomes a page
for that search and a teaser for the show, and its "Watch the real date" turns a curious visitor into a character in
the builder. The playbook's rule applies: under 50 visitors a week, a mission brings visitors (a search page) rather
than changing the landing page or the price.

**The number.** 47 unique visitors a week now (RepoHQ's `visit`; 46 of them "direct"). The target is 50 a week within
14 days of the merge.

**What changed, and why**
- **`/tools/oc-chemistry-test`**, the page for the search. It has an "OC Chemistry Test" heading, "Chemistry Test" in
  its `<title>`, and a form for two characters. Each has a name, an optional age, three traits, a want and a
  dealbreaker, with `/create`'s limits: 40 characters for a name, 30 for a trait, 140 for a want or a dealbreaker, ages
  18 to 1000. The page explains how the test works and links an example result. It has its own description, canonical
  link and share card, it's in `sitemap.xml`, and it's linked from every page's footer and from a new "Free tools for
  OC writers" list near the bottom of the home page, next to the ship name generator.
- **The result, `/tools/oc-chemistry-test/result?a_name=…&b_…`.** The form is a plain GET, so a result's address is
  the two sheets: it works without JavaScript, and anyone who opens the link sees the same result. The page
  server-renders both names, the score out of 100, the predicted ending and three one-line reasons, plus a copyable
  link and the sheets to change and test again. Its og:title is "Mira Quell × Otto Brand: 73/100, a second date", and
  its og:image is the result's own card (`/api/og/chemistry?…`, the same query): the pair, the score and the ending.
- **The test** (`lib/chemistry.ts`) runs the show's own engine (`lib/engine.ts`) on the two sheets, the way it would
  decide a first date between two new characters. Each side plays the temperament its traits describe
  (`lib/temperament.ts`, as for a character with no soul) on a new character's settings. The secret agendas and the
  night's roll of the dice are seeded from the two sheets, so the same two always get the same result, in either
  order, and case and spacing don't matter. No model, no database, no network: it works with every LLM variable unset.
- **The score** is the engine's deciding number (`endingScore`'s `rel`, the same one the box score's "why" explains),
  scaled onto each ending's stretch of 0–100: under 40 is a disaster, 40 to 69 just friends, 70 and up a second date.
  So the number and the ending can never disagree.
- **The reasons** say what the engine read: whose dealbreaker tripped, and on what word; who has what the other
  wants; and a shared trait, or the temperament their traits describe ("quick to joke, which eases the awkward
  moments"). Each word is quoted as the visitor wrote it, not as the engine's stem ("curious", not "curiou").
- **"Watch the real date"** goes to `/create` with both sheets in its address. The builder opens with the first
  character's name, age, traits, want and dealbreaker filled in. A note says where the sheet came from and links
  "Build Otto Brand instead", which opens it with the second sheet filled in. `/create` takes only sheets that pass
  the test's checks, and without them it's unchanged (the ship page's `?name=` still works).
- **The show's rules, with `/create`'s messages.** An age under 18 gets "Characters must be adults (18+).", a minor in
  the words gets "Characters must be adults, with nothing suggesting they are under 18.", a real person gets
  "Characters must be original: no real people." and sexual content gets "Keep the character sheet free of sexual
  content." The limits get the builder's own messages too ("At most 40 characters.", "At most 5 words.", "Required.").
  The test calls `POST /api/characters` with the same sheets and holds every message equal. A refused field is never
  put back in the form, and a refused pair gets no score, no link to `/create`, `noindex` and the test's own title
  and card.

**How it's measured**
- **The headline:** unique `visit`s a week on RepoHQ, as before. Success is 50 a week or more within 14 days of the
  merge.
- **Attribution:** `visit`s with `path` `/tools/oc-chemistry-test` (search arrivals) and
  `/tools/oc-chemistry-test/result` (shared results), with their referrers (google.com, bing.com, reddit.com,
  discord.com). The beacon sends a page's path without its query (`beaconPath`, also through the 18+ gate), so nothing
  typed into the sheets reaches RepoHQ. If the week reaches 50 but these paths add little, the rise came from
  somewhere else.
- **Downstream:** `activate` (a first date) can't be tied to a visitor without cookies. The read is whether
  activations rise alongside the test's visits.
- **Caveats:**
  - Ranking for a new page can take longer than 14 days. If the window closes with impressions in Search Console but
    few clicks, read it as "not yet", not "no".
  - Google Analytics, when it's on, records page addresses, so it sees the sheets in a result's address, as it sees
    the names in a ship page's. They're fictional characters' sheets, and the RepoHQ beacon never gets them.

**Decisions made without asking** (no one to ask; recorded here):
1. **The real date can't be the two of them.** On the website a person's own two characters can't date each other
   (`POST /api/episodes`; `tests/episodes.test.ts` "can't ask out your own character"). Changing that is a product
   rule, not this mission's. So "Watch the real date" opens the builder with the first sheet in and the second one
   click away, and the copy says so plainly: "Your characters date the show's house cast and other creators'
   characters, not each other". It also says a real date reads more than the test does (a bio, a private soul, the
   settings you pick), so it can end differently. If the clicks show people want this pair on a date, "date your own
   two" is the experiment to propose next.
2. **One rule is the test's own: a tripped dealbreaker is always a disaster.** The engine usually agrees, but a warm,
   funny pair can pull through to "friends" with one tripped. The test also matches a dealbreaker to the other's traits
   as a phrase ("loud" in "loud people", "liar" in "compulsive liar"), because the engine reads word by word and skips
   its stopwords ("loud" is one, from "out loud").
3. **The age is on the form, and optional.** `/create` asks for one and the engine never reads it. When it's given,
   the test holds it to `/create`'s 18 to 1000 and carries it into the builder.
4. **Results are `noindex, follow`.** Each one is free text in a long address. The tool page is the one for search,
   and a result is for sharing, with its own card.
5. **The 18+ gate stays on these pages**, as on the ship name generator, for the same reason (GROWTH 2026-10-20,
   decision 1). Crawlers pass it, and a person's visit counts for the page they were headed to.
6. **No new dependency, and nothing to provision** (no `.provision` line). Checkout, Stripe and prices are untouched.
7. **Step 0 (gstack):**
   - It reuses what was there: the engine and its `endingScore`, the temperament from traits, the content filter,
     `pairNames`, `ShareLink`, `next/og`, the ship generator's shape (a GET form, a shareable result, one click into
     `/create`), the sitemap's `PUBLIC_PATHS`, the beacon's path and the screenshot harness. The engine's only change
     is one `export` (`cues`, so a reason can name the word that matched).
   - It's more than 8 files, but each is small: one library, the tool and result pages, their form, a card with two
     routes (the tool's `opengraph-image` and the result's `/api/og/chemistry`), and small changes to `/create`, the
     footer, the home page, the sitemap list and the CSS. One new library and no new service.
   - The web search check wasn't run. Everything is a Next built-in (pages, route handlers, `generateMetadata`,
     `ImageResponse`) or existing code. The one framework question (a parent segment's `opengraph-image` against a
     page's own `openGraph.images`) was checked against the production build: exactly one og:image, the result's card.
8. **The sweep test is `tests/zz-scratch-chem.test.ts`.** It began as a scratch file, and this sandbox blocks `rm`
   and `mv`, so it was made into a real test under the name it had: every result well-formed and in its band, the
   same in either order, every ending reachable. Renaming it to `zz-chemistry-sweep.test.ts` is a safe one-line
   follow-up.

**Self-review** against gstack's checklist:
- **Pass 1 (CRITICAL):** nothing found.
  - No SQL and no database writes; `/create`'s queries are unchanged.
  - No `dangerouslySetInnerHTML`. Names and reasons render as React text. Every address is built with
    `URLSearchParams` onto a fixed path (`/tools/…`, `/create`, `/api/og/chemistry`), so there's no open redirect.
  - No model output anywhere.
  - Every new `Record` covers its whole enum: the endings' score bands, the content filter's reasons and the field
    labels. The new public path has one consumer (the sitemap), and the sitemap test's list gained it.
- **Pass 2:** four fixes.
  - The engine skips its stopwords, so "loud people" didn't trip a "loud" trait. The test now also matches phrases,
    with fixed cases and 256 generated pairs.
  - The reasons quoted the engine's stems ("curiou"). They now quote the word as the visitor wrote it.
  - "Build Otto Brand instead" kept Mira's sheet on a client-side navigation, because the builder's state is set
    once. The builder is now keyed by the pair.
  - The tool page said the agendas are seeded "the way the show does it", but the show seeds each date from the
    date itself. It now says they come from the two sheets.
- **Found in the screenshots:** three fixes.
  - With the sheets side by side, three traits in a row cut words off, so the traits stack, as on a phone.
  - On a phone, the note on `/create` pushed the filled-in sheet out of the first screen, so it's shorter.
  - The tool's shot hid its heading under the sticky header, so the script now scrolls each heading to just under
    it.

**Proof**
- `tests/oc-chemistry-test.test.ts` covers all five acceptance criteria, in 33 tests:
  - the form, its limits against `/create`'s rendered inputs, the `<title>` and the gate;
  - the same result twice, with no model or network call;
  - the dealbreaker rule on fixed cases and over 256 generated pairs, all three endings and their bands, and the
    reasons;
  - the address round trip, the rendered result, og:title, the cards and `noindex`;
  - "Watch the real date" through `/create` and back to the second sheet, every refusal's message against
    `POST /api/characters`, and the limits;
  - the sitemap, the home page, the footer rendered on `/create`, and the beacon's path.
- `tests/zz-scratch-chem.test.ts` checks the test over a sweep of generated pairs. `npm test` passes in full (2,211
  tests), and `tsc --noEmit` is clean.
- `npm run screenshots:chemistry` runs the same checks over HTTP against the production build, then captures the six
  README screenshots and follows "Watch the real date" and "Build Otto Brand instead" in a real browser.

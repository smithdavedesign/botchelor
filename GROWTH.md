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

## 2026-10-23: the OC chemistry test, "will these two make it?"

**Mission.** Build an OC chemistry test. Writers search for character chemistry tests and OC relationship generators
(Jenova, Taskade and Headcanon Generator all go after that search). Botchelor already has the inputs (three traits, a
want, a dealbreaker) and an engine that decides a second date, just friends or a disaster. As a free test, the engine
becomes a page people search for and a teaser for the episode, and its button turns a curious visitor into someone
building a character. Under 50 visitors a week, the playbook says a mission brings visitors (an SEO page). It doesn't
change the landing page or the price.

**The number.** 45 unique visitors a week now (RepoHQ's `visit`). The target is 50 a week within 14 days of the merge.

**What changed, and why**
- **`/tools/oc-chemistry-test`** is the page for the search. It has an "OC Chemistry Test" heading and title, and one
  form for two characters. Each character has a name, three traits, a want and a dealbreaker, with `/create`'s labels
  and limits: 40, 30, 30, 30, 140 and 140 characters, and at most 5 words in a name. The page explains how the test reads
  a pair and what each score band means, and ends by pointing at the show. It has its own canonical link, description
  and share card. It's in `sitemap.xml`, the footer on every page (`/create`'s included) links it next to the ship name
  generator, and so does a new "Free tools for your OC" card on the home page.
- **`/tools/oc-chemistry-test/result?a_name=…`** is the result. The form is a plain GET, so a result is a link that works
  without JavaScript. The server renders both names, a score out of 100, the predicted ending and three one-line reasons.
  Then come a copyable link, the form again (filled in) and **"Watch the real date"**. The og:title is, for example,
  "Juniper × Dex: 71/100 chemistry, a second date", and the og:image is the pair's card (`/api/og/chemistry?…`, a
  1200×630 PNG).
- **The test** (`lib/chemistry-test.ts`) is the show's own engine, minus what a test can't know. It runs
  `lib/engine.ts` on the five fields with the engine's defaults and takes out the engine's luck: each variable's seeded
  jitter, removed using the engine's own trace. It also averages over the secret agendas, every pairing of the six. So
  the same two characters get the same answer every time, in either order, and the score only moves when a field does.
  There's no model, no randomness and no database, and it works with every model variable unset. The margin maps onto
  three bands: 0–39 is a disaster, 40–64 just friends, 65–100 a second date. One rule sits on top of the engine. If a
  character's dealbreaker names one of the other's traits ("Brash people" and "brash"), it's a disaster. The engine
  counts a tripped dealbreaker as its heaviest penalty but not a verdict: Wren and Teo, who share everything else,
  still escape a disaster on some agendas. The test makes the dealbreaker decide. The reasons are ranked by how far each
  engine term moved the score: a dealbreaker, a want met, traits in common, and the temperament the traits' words
  describe. When fewer than three moved it, what's missing fills in (for example "Neither one's dealbreaker comes up").
- **"Watch the real date"** goes to `/create` with both characters in the address. The builder opens with the first
  character's name, traits, want and dealbreaker filled in. A card above it shows the second character's fields and a
  link to build them first. After the first is made, "Build Dex next" opens the builder with the second's fields in. The
  card says plainly that one person's two characters don't date each other (the episode route and the swipe deck both
  rule it out), so each meets the house cast, a match or a blind date. `/create` only takes a pair the test itself
  would take. Anything else opens the builder as before.
- **Safety, as `/create` does it.** Every field goes through the show's filter (`lib/safety.ts`), and a refusal says
  exactly what `/create`'s save says. The messages moved from `app/api/characters/route.ts` to
  `CHARACTER_REJECTION_MESSAGES` in `lib/safety.ts`, so the two can't drift apart. A refused pair gets the message,
  which character and field to check, no score, no link to `/create` and `noindex`. The refused text is never echoed in
  the page, its tags or its card. The rest of the form comes back filled in.
- **The beacon is unchanged.** A result counts as `/tools/oc-chemistry-test/result`. The two characters are in the query,
  which never goes to the beacon (on the 18+ gate too). The privacy page now says so, next to the ship pages.

**How it's measured**
- **The headline:** unique `visit`s a week on RepoHQ, as before. Success is 50 or more a week within 14 days of the
  merge.
- **Attribution:** `visit`s with `path` `/tools/oc-chemistry-test` (search arrivals) and
  `/tools/oc-chemistry-test/result` (shared results), with their referrers (google.com, bing.com, discord.com,
  reddit.com). If the week reaches 50 but these paths add little, the rise came from somewhere else.
- **Downstream:** `activate` (a first date) still can't be tied to a visitor without cookies. The read is whether
  activations rise alongside these visits.
- **Caveats:**
  - A new page can take longer than 14 days to rank. If the window closes with impressions in Search Console but few
    clicks, read it as "not yet", not "no".
  - Results are `noindex`, so only the tool page can bring search visitors. Results bring visitors when people share
    them.

**Decisions made without asking** (no one to ask; recorded here):
1. **No age field.** The brief names five fields: a name, three traits, a want and a dealbreaker. The engine never reads
   an age, so "under 18" means what the filter refuses in those fields ("16 years old", "a high schooler"), with
   `/create`'s message for it. `/create` still asks for the age, 18 or over, before anyone saves a character.
2. **Results stay out of search** (`noindex, follow`), and each has a canonical address with its fields in a fixed
   order. A result is text a visitor typed, and indexing every one invites thin pages and spam. The tool page is the one
   to rank.
3. **"Watch the real date" doesn't promise the two a date together.** The button keeps the words the brief asked for.
   The copy next to it, and the card on `/create`, say that one creator's characters meet the house cast, a match or a
   blind date. Letting one person's two characters date each other is a product rule, not a growth change.
4. **Luck and agendas are left out, not drawn from a seed.** With a seed, changing one letter would swing the score
   by up to a band. The test should move when a field means something, so it uses the engine's maths on an
   average night.
5. **The 18+ gate stays on these pages**, as with the ship tool: crawlers pass it, and a person's visit still counts for
   the page they came for.
6. **No new dependency, and nothing to provision** (no `.provision` line). Checkout, Stripe and prices are untouched.
7. **Step 0 (gstack):**
   - It reuses what was there: the engine and its trace, the temperament reader, the content filter and `/create`'s
     messages, `ShareLink`, the sitemap's `PUBLIC_PATHS`, the share-card pattern and the screenshot harness.
   - It touches 14 app files, over the guideline's 8. Each change is small: one library, the tool page, its form, the
     result page, one share-card route, `/create`'s page and wizard, the footer, the home page, the sitemap list, the
     shared messages (`lib/safety.ts` and the route that used to hold them), one privacy sentence and one `export` in
     the engine (`cues`, so the test matches words exactly the way the engine does). Plus CSS, the screenshot script,
     tests and docs. There's no new service.
   - The web search check wasn't run. Everything is a Next built-in (`searchParams`, `generateMetadata`,
     `ImageResponse`, `redirect`) or existing code, checked against `node_modules/next/dist/docs`.

**Self-review** against gstack's checklist:
- **Pass 1 (CRITICAL):** nothing found.
  - No SQL and no database writes.
  - No `dangerouslySetInnerHTML`: names and reasons are rendered as React text, and Satori draws them on the card.
  - No open redirect: the only redirect goes to the tool, and every link built from the fields is a fixed path with an
    encoded query.
  - No model output anywhere.
  - No new enum value. Endings use the existing `ENDINGS` and `ENDING_LABELS`, and `SCORE_BANDS` is a
    `Record<Ending, …>`.
- **Pass 2:** three fixes.
  - The privacy page listed which page each beacon event counts for. It now says a chemistry result counts as its page,
    without the characters.
  - The screenshots showed cramped trait inputs ("curious" was cut off), an unstyled "Three traits" heading, and a phone
    shot that scrolled the first field under the sticky header. The CSS and the script were fixed and the run repeated.
  - The calibration is now covered by tests rather than eyeballed. Every pair of the house cast gets the same answer
    both ways round, inside its band, with three tidy reasons, and the cast spreads across all three endings.
- **Noted, not changed:** Next's own `<script>` payload on a result page carries the page's address, so a refused
  name the visitor typed into their address bar is in that payload. The page's markup, title, tags and card never show
  it, and the page is `noindex`. The HTTP check reads the markup.

**Proof**
- `tests/oc-chemistry-test.test.ts` covers all five acceptance criteria: the tool, the scoring rules, the result and its
  tags, the `/create` handoff with `/create`'s own messages, and the sitemap, links and beacon. That's 36 tests. It
  renders `/create` to compare limits, posts to `POST /api/characters` to compare messages, and renders the root layout
  to read the footer.
- `tests/zz-scratch-chem.test.ts` runs the test over every pair of the house cast's real sheets. The sandbox this was
  built in couldn't rename files, hence the name; `tests/zz-chemistry-preview.test.ts` would match the ship tool's.
- `npm run screenshots:chemistry` runs the same checks over HTTP against the production build, then captures the six
  README screenshots.
- `npm test` passes in full: 229 files, 2949 tests. `tsc --noEmit` is clean. The first full run caught the footer's
  order: `tests/user-feedback.test.ts` keeps "Give us feedback" last, beside the ship name generator, so the new link
  goes before them.

## 2026-10-25: the Daily Date, one blind date a day to call, no account

**Mission.** Build the Daily Date: one blind date a day to predict, with no account. RESEARCH.md's strongest
behavioural evidence is the Love Island habit: Peacock reported that more than a quarter of mobile viewers took part in
the season 7 prediction game. The growth brief says the launch kit dropped r/LoveIslandUSA because Botchelor had "no
spectator-only hook". So each day there's one house-cast date at a fixed address. You call it without an account, and
it ends in a result line you can copy that gives nothing away. That gives a spectator, someone with no character of
their own, a reason to come back each day and something to post.

**The number.** 59 unique visitors this week (RepoHQ's `visit`; 47 direct, 26 the week before). The brief's target is 50
a week within 14 days of the merge. The week is already above that, so the read is whether it stays at or above 50, and
how much of it the Daily Date brings (below).

**What changed, and why**
- **`/daily`**, today's game. It shows the day's number (#1 is Sunday 25 October 2026, UTC) and both house characters'
  public sheets: age, bio, three traits, what they want and how they look. It also says where they met. Then comes a
  form with exactly three choices: a second date, just friends, or a disaster. Nothing on the page says how it ends.
  The server reads the two sheets through their own query (`dailyCard`), which never selects the ending or the scenes,
  so neither the markup nor Next's payload can carry them. A day with nothing to deal says "still being filmed" and
  shows no form.
- **The deal** (`lib/daily.ts`). The pool is the house cast's own dates that have already aired publicly. The lobby
  films those every day (`refreshLobby`), so no model is called and nothing is spent. Each day's date is dealt on the
  day's first read and kept in a new table, `daily_dates`, keyed by the day's number, so the same UTC day always serves
  the same date and two first reads can't deal two. The pick is the day's seeded choice (`seedFrom("daily-date", n)`)
  among the dates no day has had yet, oldest first. Once every date has had a day, it's any date but yesterday's. A
  stored day needs nothing but the database. A date reported off the air (or made private) after it was dealt is dealt
  again on its own day, by an update that only lands if the day still holds it. A past day loses it.
- **The pick** (`POST /api/daily { n, pick }`). It answers with the date: the ending, the scenes, the best line, why it
  ended that way, and whether the pick was right. No account and no cookie, and nothing about the visitor is stored.
  The streak lives in the browser's localStorage (`lib/daily-shared.ts`): right picks in a row, and a wrong or missed
  day starts it over. A reload on a day already played shows the result again. After the pick, a countdown runs to the
  next Daily Date (midnight UTC). A tab left open past midnight offers the new day.
- **"Copy result"** copies `Botchelor Daily #12 ✅ Called it`, `Streak: 2` and `https://botchelor.com/daily?ref=daily`.
  It never includes the ending or either character's name, so pasting it spoils nothing. The line shows as it will
  paste, so it can still be copied by hand if the clipboard is blocked.
- **`/daily/{n}`**, a past day with its ending: the sheets, how it ended, the scenes and a link to the whole episode.
  Today's number redirects to `/daily`, where it's still a game. A day still to come, or one nobody dealt, is a 404.
- **Findable.** `/daily` is in `sitemap.xml` and has its own title, description, canonical link and an og:title of
  "Botchelor Daily #n: how does today's blind date end?". The home page links it first in the hero, as a small pill
  above the heading: "🗓️ Daily Date #n: guess how today's blind date ends. No account."
- **The beacon counts the tag.** A `visit` from `/daily?ref=daily` carries `ref: "daily"` (`BEACON_REFS` in
  `app/funnel.ts`), on the 18+ gate too. `activate` and `checkout` are unchanged. The privacy page says so, and says a
  pick comes to us only to be checked.
- **The hourly lobby job** deals today's date in the day's first hour, so a day nobody visited still has one, and the
  next day's "yesterday" link and `/daily/{n}` exist.
- A `daily_pick` log event (the day's number, whether the pick was right and whether it was today's; never who).

**How it's measured**
- **The headline:** unique `visit`s a week on RepoHQ, as before. Success is 50 or more a week within 14 days of the
  merge.
- **Attribution:** `visit`s with `ref` = `daily` are people a copied result brought. `visit`s with `path` `/daily` are
  everyone who landed on the game itself: a post, a bookmark or a shared line. A visitor who starts on the home page
  and clicks through counts as `/`, as before. If the week holds at 50 or more but few visits carry `ref=daily` or
  `path` `/daily`, the visitors came from somewhere else.
- **Coming back:** the beacon counts a visit once per browser session with no cookies, so a returning player can't be
  told apart from a new one there. The `daily_pick` events in the logs count picks per day. If picks a day grow while
  new visits don't, people are coming back.
- **Caveats:**
  - If RepoHQ ignores an unknown `ref`, attribution falls back to `path` `/daily` and the referrers (reddit.com,
    discord.com).
  - The Daily Date needs aired house dates. The lobby's rooms air when someone starts watching one. If none had aired,
    `/daily` would say "still being filmed" and offer no game.
  - Posting it anywhere (r/LoveIslandUSA included) is David's call, under each community's rules. Nothing here posts.

**Decisions made without asking** (no one to ask; recorded here):
1. **Only dates that already aired.** An unaired house date can still be predicted for points on its own page.
   Revealing its ending here would hand those points out. An aired one gives away nothing the show hasn't already.
2. **#1 is the day it was built, 25 October 2026 (UTC).** The number is a pure function of the date, so a shared "#12"
   means the same date to everyone. If it merges later, the first number anyone sees is a little higher. Days before
   the first deal are 404s.
3. **The sheet is the public card.** It shows what the character's own page shows, so no dealbreaker: that stays the
   show's secret, as in Guess the Dealbreaker.
4. **Before the pick: the sheets and where they met, nothing more.** The episode page shows the setting before the
   finale airs too. The scenes, finale, best line and the "why" come only with the reveal.
5. **The pick is checked on the server and not kept.** That way the page itself never has the answer. The streak is
   the browser's. That's the "no account" promise, and there's nothing to delete.
6. **A past day is `noindex`.** The same date is on its own episode page, which is the one to index. `/daily` is the
   page to rank.
7. **The 18+ gate stays on `/daily`,** as with the tools: crawlers pass it, and a person's visit counts for `/daily`
   with its `ref`.
8. **No new share card.** A page's own `openGraph` drops the image it would inherit, so `/daily` names the site's
   existing card, which gives nothing away. A Daily-specific card would be the next experiment if links get shared and
   not clicked.
9. **The home link is a pill above the heading, not a line under the buttons.** Under the buttons, the Playwright run
   measured it at 841px on a 1280×800 desktop, below the fold. The hero's narrow copy column wraps the buttons. At the
   top it's in the first screen on desktop and on an iPhone 13. "Make your character" stays the main button.
10. **No new dependency, and nothing to provision** (no `.provision` line). Checkout, Stripe and prices are untouched.
11. **Step 0 (gstack):**
    - It reuses what was there: the lobby's house dates, the public layer's rules (`publicDateSql`), the spectator view
      (`getEpisodeView`, for the reveal and the "why"), `seedFrom`, the beacon's tag allowlist, the sitemap's
      `PUBLIC_PATHS`, the site's share card and the e2e harness.
    - It touches 9 existing files: the home page, the beacon, the sitemap list, the schema, the lobby job, the
      analytics event list, the privacy sentence, the CSS and `package.json`. It adds two libraries (pure and
      database), two pages, a game component, a sheet component, a story component and one route. That's over the
      guideline's 8. Each is small, and there's no new service.
    - The web search check wasn't run. Everything is a framework or browser built-in (route handlers,
      `generateMetadata`, `redirect`/`notFound`, `navigator.clipboard`, `localStorage`, Playwright's `page.clock`),
      checked against `node_modules/next/dist/docs`.

**Self-review** against gstack's checklist:
- **Pass 1 (CRITICAL):** nothing found.
  - Every query takes its values as parameters. The SQL built in code is fixed aliases and the report threshold.
  - The deal is atomic: the day number is the primary key (`on conflict do nothing`, then read back), and a re-deal is
    an `update … where episode_id = <the old one>`.
  - No `dangerouslySetInnerHTML`. The model-written scenes are rendered as React text, as on the episode page.
  - The new values each have one consumer: `ref: "daily"` (the beacon's allowlist), the `daily_pick` event (logs
    only) and the conversion surface `"daily"` (an analytics parameter). Nothing switches on them.
- **Pass 2:** four fixes.
  - The pool's "has scenes" test used `jsonb_array_length`, which throws on a non-array, and SQL doesn't promise which
    test runs first. One odd row anywhere could have broken `/daily`. It's `jsonb_typeof(…) = 'array'` now, with a
    test.
  - `DailyCard` carried two fields nothing read. They're gone.
  - The privacy sentence's first draft said picks are never sent to us. They are, to be checked, so it says that now.
  - `/daily` had no og:image (above). It names the site's card now, and a test pins it to `app/opengraph-image.tsx`.
- **Noted, not changed:** the reveal reads the date through `getEpisodeView`, which also reads its transcript, so a
  pick costs about one episode page view in database transfer. Like `/api/predictions`, it has no rate limit. At this
  traffic that's small. A slimmer query is the fix if it ever shows in the Neon usage.

**Proof**
- `tests/daily-date.test.ts` covers all five acceptance criteria in 25 tests, with the server's clock frozen (Date
  only). It checks the gate and a crawler. It checks the page's number, sheets and three choices. The no-spoiler test
  renders two days with the same two characters and different endings and checks that every ending's value and label
  appears equally often on both. It also checks that nothing handed to the page's components (the RSC payload) has an
  ending or scenes. It checks that the same day keeps its date while new dates air, that a new day gets a new one, and
  the seeded deal against the pool. It checks what the pool leaves out (unaired, private, unlisted, reported, replays,
  scenes that aren't a list, a person's OC). It checks `/daily/{n}`, every model variable unset, a re-deal, the hourly
  job, the reveal route, the streak, the stored history, the copied line and the result's button. Last come og:title,
  the sitemap, the home link and the beacon. Planting a leak (the last scene handed to the game component, never
  rendered) fails the no-spoiler test.
- `npm run e2e:daily` is the Playwright test. It starts the production build with every model variable unset, seeds
  four sample house dates and runs the acceptance checks over HTTP, including the real HTML and RSC payload. Then
  Chromium calls day one right ("Streak: 1"). The server restarts a day later (`scripts/fake-clock.mjs`, preloaded with
  `NODE_OPTIONS`; the app has no test hook for time) and `page.clock.fastForward("24:00:00")` moves the browser's clock
  on. The page offers the new day, calling it right shows "Streak: 2", a reload keeps it, and "Copy result" puts the
  spoiler-free line on the clipboard. Finally `/daily/{yesterday}` shows its ending.
- `npm run screenshots:daily` is the same run, saving the six README screenshots.
- `npm test` passes in full (numbers below). `tsc --noEmit` is clean. The first full run caught one thing:
  `tests/pages.test.ts` pins the sitemap's public pages exactly, and now lists `/daily` too.

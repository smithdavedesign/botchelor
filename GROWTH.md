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

## 2026-10-20: a free OC chemistry test ("will these two make it?")

**Mission.** Build an OC chemistry test. Writers search for character chemistry tests and OC relationship generators
(Jenova, Taskade and Headcanon Generator all target that search). Botchelor already has the inputs (three traits, a
want, a dealbreaker) and a rules engine that decides second date, friends or disaster. Offered as a free test, the
engine becomes a search page and a teaser for the episode, and its button sends a curious visitor to `/create`. The
playbook's rule still applies: under 50 visitors a week, a mission brings visitors (a search page). It doesn't change
the landing page or the price.

**The number.** 42 unique visitors a week now (RepoHQ's `visit`). The target is 50 a week within 14 days of the merge.

**What changed, and why**
- **`/tools/oc-chemistry-test`** is the page for the search. Its title is "OC Chemistry Test: will these two make it?".
  The form takes two characters, each with `/create`'s fields and limits: a name (40 characters, 5 words), three traits
  (30 each), a want and a dealbreaker (140 each). Below it: how the test works, "original characters only", and a
  closing line pointing OC owners at the show. It has its own description, canonical link and share card. It's in
  `sitemap.xml`, and the footer on every page (so the home page and `/create` too) links it next to the ship name
  generator.
- **`/tools/oc-chemistry-test/result?a_name=…`** is the result. The form is a plain GET, so it works without
  JavaScript and every result is a link. The page server-renders:
  - both names, the score out of 100, the ending, and three one-line reasons;
  - a link to copy, and the form again to change something;
  - "Watch the real date".
  Its og:title holds both names, the ending and the score. Its share card comes from `/api/chemistry-card?<the same
  query>`, a route under `/api` so the 18+ gate never blocks an unfurler.
- **The test** (`lib/chemistry-test.ts`) is the engine every real date runs on (`lib/engine.ts`). It runs a first date
  at the show's default settings on the six fields:
  - each side plays the temperament its traits describe (`lib/temperament.ts`, as the builder reads it);
  - each side gets a secret agenda dealt by the seed, the way `buildDate` deals them;
  - the seed comes from the two sheets, ignoring case and spacing.
  No model, no randomness, no database. The score bands are 0–39 a disaster, 40–69 just friends and 70–100 a second
  date. Where a score falls inside its band comes from the engine's margin, so a score always agrees with its ending.
  **A tripped dealbreaker is always a disaster.** The engine weighs one heavily, but on its numbers alone a pair that
  lines up everywhere else could still scrape "friends". A dealbreaker goes off when the engine's cue matching
  finds one of the other's words in it. It also goes off when it names one of the other's traits word for word,
  checked directly on the sheet: lowercase, accents folded, a plural's "s" dropped, nothing skipped. The engine's
  matching drops stopwords, short words and accented letters, so on its own "Loud people" never met a trait of
  "loud", and "naïve" split into nothing (review fix). That is the decided rule, with no exception for idioms: Marisol's
  "Earnest poetry read out loud" and Teo's "Counting the steps out loud" go off on Sable's "loud". The reasons, in
  order:
  - a tripped dealbreaker first, saying whose it was and the trait or word it went off on;
  - then wants met or missed, shared traits and temperament, in the order that explains the ending;
  - then a summary and the box score's numbers.
  Across the 210 ordered pairs of the house cast: 38 second dates, 119 friends and 53 disasters, with scores from 0
  to 82. Before the direct trait check it was 41, 120 and 49; the difference is the four pairs of Sable with Marisol
  or Teo. `tests/zz-scratch-chem.test.ts` holds these figures.
- **Safety, with `/create`'s own words.** The test uses the show's filter (`lib/safety.ts`) on every field. A refusal
  shows `/create`'s message: under 18 ("16 years old", "teen", "under 18"), a real person, or sexual content. Those three
  messages used to be copied in both character routes, so they now live once in `lib/safety.ts`
  (`CHARACTER_REJECTION_MESSAGES`). Both routes and the test use it, and a test compares the test's message with what
  `POST /api/characters` answers. An empty or too-long field gets `/create`'s limit message ("Required.", "At most 40
  characters.", "At most 5 words."). A refused field is never echoed back: not in the page, the form, the title or the
  card. Every other field comes back in the form.
- **"Watch the real date"** goes to `/create?name=…&trait1…&want=…&dealbreaker=…&with_name=…&with_trait1=…`. The
  builder opens with the first sheet in (age and bio still to fill). A note says where it came from, with a "Build Fitz
  next" link that opens the builder with the second sheet in. The same link shows again once the first character is
  made. `prefillFromQuery` keeps each field to the builder's limit and drops anything the content rules refuse. The
  ship page's `/create?name=` works as before.
- **The beacon is unchanged.** A result's sheets live in its query string, and the beacon sends only the pathname. So
  a result counts as `/tools/oc-chemistry-test/result`, through the 18+ gate too, and nothing typed reaches RepoHQ. A
  test checks it, and the privacy page's wording still holds.

**How it's measured**
- **The headline:** unique `visit`s a week on RepoHQ, as before. Success is 50 a week or more within 14 days of the
  merge.
- **Attribution:** `visit`s with `path` `/tools/oc-chemistry-test` (search arrivals) and
  `/tools/oc-chemistry-test/result` (shared results), with their referrers. If the week reaches 50 but these paths add
  little, the rise came from somewhere else.
- **Downstream:** `activate` (a first date) can't be tied to a visitor without cookies. The read is whether activations
  rise alongside these paths.
- **Caveats:**
  - The ship name generator's window (from 2026-10-20) overlaps this one. Their paths are what separate them.
  - Ranking for a new page can take longer than 14 days. Impressions in Search Console with few clicks mean "not yet",
    not "no".

**Decisions made without asking** (no one to ask; recorded here):
1. **Your own two characters still don't date each other on the website.** The episodes route refuses a partner you
   own, and `tests/episodes.test.ts` ("can't ask out your own character") holds that rule. So "Watch the real date"
   opens the builder for both sheets, one after the other. The result's copy says so plainly: two characters of yours
   don't date each other on the show; each goes out with this season's cast or a match; a friend's OC can match yours
   in the swipe deck. Letting a person send their own two OCs on a date together would make the button literal (agents
   already can, on their own model, with `start_own_date`). That's a product call for David, and the next experiment
   to propose if people click through.
2. **No age field on the test.** The brief lists name, traits, want and dealbreaker, and the engine never reads age.
   "Under 18" is caught in the text, where `/create` catches it, with the same message. `/create` still asks for the age
   before saving.
3. **Results stay out of search** (`noindex, follow`). They're typed text, which would be a spam vector if indexed. The
   tool page is the one to rank, and results aren't in the sitemap.
4. **The 18+ gate stays on**, as decided for the ship name generator. Crawlers pass it, and a shared result keeps its
   whole address through the gate.
5. **The prediction uses the show's default settings** (balanced autonomy, genuine chemistry, the default date
   budget). A new character's dates start from the same defaults. A real date also reads the bio, the private soul,
   the owner's settings and its own seed, and the result page says it can still go another way.
6. **The reasons name the dealbreaker's word.** The box score's "why" names only whose dealbreaker went off, to keep
   the guess-the-dealbreaker game. Here the visitor typed both sheets and they're already in the link, so hiding the
   word would hide nothing. The tool page says the link carries both sheets, dealbreakers included.
7. **The sample pair is invented** (Odessa Crane and Fitz Harlow), not the house cast. Its dealbreaker avoids the
   builder's stock-phrase list: "rude to waiters" was the first draft, and `/create` flagged it.
8. **No new dependency, and nothing to provision** (no `.provision` line). Checkout, Stripe and prices are untouched.
9. **Step 0 (gstack):**
   - It reuses what was there: the engine, the trait temperament, the content filter and its messages, `ShareLink`, the
     sitemap's `PUBLIC_PATHS`, the share-card pattern, the builder's prefill and the screenshot harness. One change
     inside the engine: `cues` is now exported, so the reasons name the same words the engine matched. Its behaviour
     is unchanged.
   - It's more than 8 files, but each is small: one library, two pages, a form, a card and its route, and small edits to
     `/create`, the footer, the sitemap list and the two character routes. No new service.
   - The web search check wasn't run. Everything here is a Next built-in (route handler, `generateMetadata`,
     `ImageResponse`) or existing code.

**Self-review** against gstack's checklist:
- **Pass 1 (CRITICAL):** nothing found.
  - No SQL and no database writes.
  - No `dangerouslySetInnerHTML`; typed text is rendered as React text or attributes.
  - No redirects. Every link is built with `URLSearchParams` onto a fixed path (`/create?`, the result, the card).
  - No model output anywhere.
  - Every new value is covered: `Ending` by the score bands, the margin spans and the CSS; `ChemistryError` by one
    generic fix page. The beacon's kinds are unchanged.
- **Pass 2:** two fixes. With a name of only spaces, `/create`'s note read "their's". The first sample dealbreaker was
  a stock phrase. Both are fixed.

**Proof**
- `tests/oc-chemistry-test.test.ts` covers all five acceptance criteria. It also covers `/create`'s prefill and its
  limits, the share card, and the beacon's path.
- `tests/zz-scratch-chem.test.ts` checks the test over every ordered pair of the house cast: every ending gets a real
  share, and there are three distinct reasons that fit the ending. The name is left over from a scratch run, and this
  sandbox couldn't rename or delete files; rename it `zz-chemistry-preview.test.ts` freely.
- `npm run screenshots:chemistry` runs the same checks over HTTP against the production build, then captures the six
  README screenshots.

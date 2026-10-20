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

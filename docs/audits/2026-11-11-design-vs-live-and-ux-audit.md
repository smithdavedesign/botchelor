# Botchelor, 2026-11-11: the design system against the live site, and a product, UI/UX and IA audit

The design system (Claude Design, four rounds; `docs/design-system-rollout.md`) is fully merged: #1446, #1447, #1448,
#1451 and the icon fix #1452, live on `76fab79`. David asked for two things on top of that: a high-level review of
what the kit shows that the site still doesn't, and a fresh product, UI/UX and information-architecture audit of the
site as it is today. This is both.

How it was run: botchelor.com on `76fab79`, Chromium at 1280×900 and 390×844, as a first-time visitor past the 18+
gate with no account and no character (the kit's own default persona). Seventeen paths at both widths: home, /watch,
/characters, /companion, /create, /pricing, /reunion, /showcase, /reviews, /graph, /casting, /vote, /faq, /account,
/shop, the first episode and the first open room linked from /watch. Every claim about the kit comes from its Round 4
`readme.md` ("What is source and what is new") and every claim about the app from `origin/main`. A 14-page link crawl
mapped which of the 96 page routes the main pages reach.

Not covered, on purpose: After Dark as a subscriber (it isn't open to a visitor, see A1), the dark theme (proved in
#1451), accessibility (axe ran on 2026-11-01), the funnel past /create (no test data was made on production today),
and live traffic numbers (real use is still near zero; the engagement log is the place to read it once it isn't).

## The short version

1. **The kit is live where it is a visual system.** Themes, the five-thing header, the two meters, the icons, the
   envelope, the season arc, the live facts, the Best value flag and the control contrast are all on the site, and the
   rest of the kit's "lifted" list was already the app's. Part 1.1 is the table.
2. **The biggest gap between the kit and the site is policy, not design.** The kit's whole After Dark half (the door
   in every header, the arrival screen, the age gate, the paywall, the token packs, the night's theater) is built, but a
   visitor can't reach any of it: the door renders only for someone already entitled, and /after-dark sends everyone
   else to a "This page isn't on the show" page. That is David's standing call (no public After Dark until counsel and
   a processor), and it's the right one; it just means half the kit describes a product nobody outside can see yet.
3. **Eight kit proposals are built nowhere, by agreement.** Three are worth doing now because they fix things this
   audit found on its own: Characters as the hub with "Talk" on every card (Companions is a second product hidden
   behind a fifth door), the first-run track (the home's sample card is halfway there) and a lighter character creator.
4. **The product's front door repeats itself.** The same aired date appears three times on home above the fold (the
   hero's sample card, the Tonight band's "Just aired", the grid) and again at the top of /watch; home and /watch share
   half their blocks. The most participatory thing on the site, tonight's situation vote, is the fifth block on a
   4,681px page.
5. **The IA is shallow and reachable** (every route in two clicks from five doors, five tabs and four footer groups);
   its problem is names, not depth: the same four house characters live under "cast", "Characters" and "Companions",
   the "Seasons" tab opens "The Reunion", and clips are "Reels" on the show and "Shorts" after dark.
6. **Defects found today:** the open room's prediction shows twice on one desktop screen; Pricing's Free card and the
   Companions page disagree about free replies; loading an open room's page started it (a crawler can spend house
   dates); the Companions filter row cuts off at a phone's edge with no hint. (Three house-cast companions looked
   portrait-less in the sweep's screenshot; that was lazy-loading caught mid-way, every portrait file answers 200.)

## Part 1: live versus the design system

### 1.1 Shipped from the kit

| Kit decision | Where it lives | Landed |
| --- | --- | --- |
| Light / Dark / System pick, cookie into `<html data-theme>`, two identical dark-token blocks | `app/ThemeSetting.tsx`, `lib/theme.ts`, `app/globals.css`, `tests/theme.test.ts` | #1446 |
| Header: five kinds of thing; tagline out; the After Dark door a night-coloured link with ↗; moon badge and "Back to the show" on After Dark's host; words → plus → menu at 1180 / 900 / 560 | `app/Nav.tsx`, `app/layout.tsx` | #1446 |
| Two meters, two units: clapper on the dates pill, ◈ on the night token pill | `.token-pill--dates` / `--tokens` | #1446 |
| After Dark control edges `--field` #7a5f93 (3.2:1) | `app/globals.css` | #1446 |
| The icon set: the 13 originals plus the kit's 26, drawn, no emoji in kickers or headings | `app/Icon.tsx` (39 names) | #1442, #1452, #1447 |
| `Reveal`: the envelope that unseals once a week, reduced motion opens it at once; the card stays while the result is fresh | `app/Reveal.tsx`, `app/WeeklyReveal.tsx`, `app/ux/show.css` | #1447 |
| `SeasonBanner` as the running arc (season · month · night · days to the finale · format), closed strip the first week | `app/SeasonBanner.tsx` | #1447 |
| `LiveNow` facts under the Tonight band, only facts the page has | `app/TonightBand.tsx` | #1447 |
| `generateViewport` theme colour follows the pick | `app/layout.tsx` | #1447 |
| `TokenPacks`: Best value once, on the cheapest token the processor sells | `app/after-dark/tokens/BuyTokens.tsx` | #1448 |
| Proof in the README | `docs/screenshots/design-system-*.png` | #1451 |

Already the app's before the rollout, checked rather than built: the whole-card link (`.tap-card` + `.stretch`), a
price on every token-spending button (`lib/adult/price-words.ts`), `LimitNotice` wording, `PageSkeleton` shapes, every
`EmptyState` ending in a step, the crisis and companion copy verbatim, the footer hiding Pricing on After Dark, the
theater folding its tool words under 760px, the AI line once per page.

### 1.2 In the kit, not on the site

**A. Hidden by policy (After Dark).** The kit's header carries `AfterDarkLink` for every adult, and the readme's
"Crossing into After Dark" describes the arrival (`Threshold`, once a session), then the age gate, the PIN, the paywall.
On the site:

- A1. The door renders only when `accessHere(...).entitled.ok && mode !== "blocked"` (`app/layout.tsx`): signed in
  and entitled (a subscription, a beta pass, an admin) and not in a blocked region. A visitor never sees it, in any
  header, at any width. The sweep's 34 screenshots contain no After Dark door.
- A2. botchelor.com/after-dark → 307 to the host's carry handshake → signed out, the not-found page ("This page isn't
  on the show", with the moon badge and "Back to the show"). ad.botchelor.com/ → 307 → botchelor.com/after-dark → the
  same end. /after-dark/subscribe and /after-dark/tokens go the same way. There is no visitor-facing landing, teaser or
  "Request an invite" anywhere in the sweep; the only trace is `AfterDarkTeaser` on couple and house-character pages
  when that pair has a night ("Cumming soon", blurred lines), and Barnaby's page showed none today.
- A3. So `Threshold`, `AgeGate`, `PinGate`, `Paywall`, `TokenPacks`, `Unavailable`, `MediaFilterBar`, `RoomTools` /
  `NightPlayer` are all live code and all unreachable for the public. Nothing to build; when David opens After Dark
  the day-one set is: the door for every adult (the gate's `afterDark` condition becomes "adult and not blocked"),
  `Threshold` once a session, /after-dark landing on the subscribe page instead of not-found, the invite request
  visible. The kit already draws all four.

**B. Proposals, built nowhere (the kit's ✎ PROPOSED tags).** By agreement these waited for David's call. Where this
audit found the problem the proposal answers, it says so.

| Proposal | Status on the site | This audit's view |
| --- | --- | --- |
| Characters as the hub: Watch · Dating · Characters · Account, Companions a "Talk" tab on each character | Companions is a fifth door; character pages do have "💬 Talk with" | **Do it** (Part 4) |
| First-run track: landing → a 20-second excerpt that plays itself → one call → the ending → "Now send yours" | Newcomers land on the full home; the hero's sample card has "Watch how it ends" | **Do it, phone first** (Part 2.1) |
| `IntensityPicker` (Slow burn / Steamy / Spicy / Unfiltered) | No viewer-facing picker; word levels are the writer's | After the public door |
| Suggestive / NSFW / Explicit filter and `NsfwBadge` names | `content_rating` tags exist; "18" is the only label | After the public door |
| "Make more" as one menu on a night's page; one gallery page for every night | Studio, Fix and moment tools are their own controls; media per pair | After the public door |
| The chapter reader (`?view=reader`) | The night page is the theater | Low; a quiet re-read view is nice-to-have |
| The gallery's 🔇 sound switch | The showcase has it (#1410 / #1415, `app/showcase/sound.ts`); After Dark's reels carry sound per piece | Done where it matters |
| The phone's ⋯ sheet in After Dark's theater | The theater keeps every tool and drops its words under 600px | After the public door; the show's room already has the phone pattern (Vote · Chat bar) |

**C. Kit components the app answers with its own.** Deliberate in the rollout; listed so nobody looks for them.

- The kit's one `Vote` component: the app keeps `SituationVote`, `DareVote`, `WeeklyReveal`, `SeasonFormatVote`,
  `BackCast`, each with its own card. Same behaviour, five shapes. Worth one shared frame when any of them is next
  touched, not a PR of its own.
- `RoomState` / `ReplayControls` wording: the show's room says it in its own words (the "Replay" chip, "N watching",
  the phase chip, the pre-show countdown). Kept.
- `LiveNow`'s richer lines ("Kaz is texting Ines now", "412 watched tonight"): the band shows only facts the page has.
  Kept; the richer lines need counters the app doesn't keep.
- `ShareCard` inside `Reveal`: the share stays in `CallsLine`, one card down. Kept.
- `ThemeSetting` as three radios, not the kit's `Check`. Kept.
- The Matches "How dating works" card, "How calls work" as a `<details>`: kept as they are.
- The kit's `PredictionPick onPhoto` variant: the app's room has no photo-backed prediction. Not needed.

**D. Emoji still used as chrome.** The kit's rule: emoji are the show's voice, never the interface's. The rollout
converted kickers and headings and classed the rest as voice; looking at the live pages, four of them are interface:

- 🎬 on the "Watch in theater" button (episode page) and "Theater mode" (room): a control, should be the clapper icon.
- 🔮 Vote · 💬 Chat on the room's phone bar: controls, should be icons (the kit draws both).
- 📍 the venue chip in the room and the kit's own `RoomTools`: the kit itself uses the emoji here, so the rule is
  inconsistent in the kit too. Pick one; the pin icon exists.
- 👩‍🎨 📡 🍿 on home's "How it works" steps: decoration on interface copy. Icons, or nothing.

Voice, and right to stay: endings and formats, the Reunion's awards (🏆 💥 💗 🤯), "💍 Going steady", reactions, the
notification kinds, "🤫 Secrets" on a character page, the Top rated chips.

**E. Left for Claude Design, if there's another round.** `.kit-theater > * { min-width: 0 }` (the After Dark theater is
wider than a 390px screen in the kit), move `.kit-stage-fine` off the seat names at ~1000px, and keep the words "After
Dark" on the door between 900 and 1180px instead of the moon alone.

## Part 2: product audit

The promise is clear and the site keeps it: "Send your OC on a blind date. Then just watch." Free, no sign-up, a
character in under a minute, nobody steers the date. Pricing is honest (four cards, nothing hidden, "Never for sale"
for points). The trust footer is thorough (18+, crisis line, content policy, 2257, one-page terms). Those are the
strengths, and the audit below is about what stands between a visitor and that promise.

### 2.1 The first screen

Home at 1280 is 3,738px: hero with a sample date card, the season arc, the Tonight band, six "Just aired" cards, How
it works, the four cast, two link rows, eight FAQ rows, a lone CTA, the footer. Three things repeat:

- The hero's sample card is Vectron × Kieran ("Drum Solo Corner Table"); the Tonight band's one line is "Just aired:
  Vectron × Kieran"; /watch opens on the same card again. A visitor who clicks Watch sees the thing they just saw.
- "Just aired" shows two "Speed-dating night" mixers side by side with near-identical copy. Two cards for one kind of
  night, on the pitch page.
- The FAQ (eight rows) duplicates /faq. On the pitch page, three rows and a link would do.

The Tonight band is right when something is live (the kit's point) and wrong when nothing is: it then repeats the hero.
When nothing is filming it should be one line ("Nothing filming now · next airing at hh:mm · Sunday's reveal in 3
days") or not there. The first-run track the kit proposes is the stronger answer for phones: on a 390px screen the hero
alone is the whole viewport and the sample card is below the fold; the excerpt that plays itself, one call, the ending,
"Now send yours" is the show in 20 seconds, and it reuses the sample card the home already has.

### 2.2 The path to the first date

Hero → "Make your character" → /create: an eight-step wizard (Identity, Voice, Look, Dating profile, More about them,
Go deeper, Inner life, Review; five are marked optional). The hero promises "under a minute"; the stepper promises
eight steps. On the phone the stepper becomes a bar and "Step 1 of 8". "Use a sample character" and "bring one from
another app" are on step 1, which is right.

Recommendation: three steps shown (Who they are · Dating profile · Review), with "Add depth" as a second track offered
after the first date is booked, when the owner has a reason to care about voice, look and inner life. If the eight
stay, the stepper should say "3 required" and group the five optional ones visually.

The funnel after the character (booking, the first airing, the first notification) was audited on 2026-11-01 and not
re-run today.

### 2.3 Coming back

The return loops are real and well made: tonight's situation vote (closes in 4h), the Sunday reveal (vote opens in 3
days, the envelope), the bell, the Sunday letter, backing the cast, leagues. All of them live on /watch, below the
hero, the strip, the live band and the "Ready to start" rooms. The situation vote is block five; the reveal is block
seven, under 12 episode cards and a 41-page pager. The page is asking to be re-ordered, not redesigned: live band →
tonight's vote and Sunday's reveal (one row) → latest episodes → everything else collapsed, as "Replays" and "More from
the show" already are.

### 2.4 Money

Four cards, plain prices, Stripe's page, a refund line. Two things to fix:

- The Free card says "30 companion replies a day"; the Companions page says 5 without an account and 30 a day with a
  free one (`COMPANION_FREE_PER_DAY = 30`). Same fact, two numbers: the Free card should say "30 companion replies a
  day with a free account (5 to try without one)".
- "Your own key" is a pricing card with no price: it's the right place for it, but "$0 from us" reads as a plan. "Bring
  your own key" as the title and "You pay the provider" as the price line would read as what it is.

After Dark's prices are absent from Pricing on purpose (A1) and the kit's footer rule agrees.

### 2.5 Companions, a second product behind a fifth door

/companion is a 197-card directory with its own search, four filters and a sort; on the phone it is 8,106px tall before
"Show 24 more". It is a chat product living inside a show. Nothing on /characters points to it (the cast cards there
have no "Talk"), the house cast appears on both pages under different framing, and the nav spends one of its five
doors on it. Character pages do link both ways ("💬 Talk with", "Their story so far"), which is the right seam. The
kit's proposal (Companions as the "Talk" tab of Characters, a "Talk" button on every character card, four doors) is
the fix; Part 4 has the shape.

A false alarm, kept so nobody chases it: Sable Quist, Teo Brandt and Wally Osei showed as gradient squares on
/companion in the sweep's screenshot. Their `<img>` tags point at `/cast/house-*.webp` files that answer 200; the
squares were the Avatar's gradient under a lazy-loaded picture the full-page capture didn't wait for.

### 2.6 Trust and safety surfaces

Every page carries the 18+ line, the crisis line and the four footer groups; the room's chat and the companions have
the AI reminder; "Report a problem" is in the footer on every page. One gap in spirit: the bell. It shows for a visitor
with nothing to be notified about (no character, no account); it leads to an empty state that does end in a step, so
it isn't a dead end, but it is a control with no job for the first ten minutes. Hide it until there is a character or a
notification.

### 2.7 A side effect worth knowing

Loading the open room's page (a GET by this audit's browser, no click) synced the room (`WatchRoom.tsx`, the mount's
`/api/watch-parties/<id>/sync`), the pre-show clock started ("Starts in 0:30"), and by the phone pass the date was in
"First impressions" with "1 watching": the audit's own browser. Any visitor with a browser user agent starts a house
date by arriving; link-preview fetchers and the crawlers `lib/bots.ts` names don't, but the next one with a plain
Chrome UA will. A house date is free, so this is a quota and a tidiness question, not money. Starting on the first
explicit action (the Start button already exists on /watch's cards) when the viewer has no prior engagement would close
it.

## Part 3: UI/UX audit, page by page

**Header.** Five kinds of thing, as designed: wordmark, meter ("3 free dates", clapper), the one CTA, four links, the
bell. The phone bar is wordmark, meter, menu. Clean. Two notes: the bell for visitors (2.6), and the After Dark door
missing for everyone but the entitled (A1), which is policy.

**Home.** See 2.1. Also: the cast strip's four cards and the Characters page's four cards are the same component with
different density, which is right. "See every character → · 🎬 Audition yours for next month" and "✨ The Constellation"
are two link rows where one would do.

**/watch.** 4,681px, 66 links, 13 buttons, ten blocks. Order (2.3). The "Ready to start" rooms (three cards + "Show all
10") sit above the vote and are, for a visitor, ten chances to start a house date by tapping. The season strip
("Season 2: Classic Botchelor · The newcomers' week · 💘 The Recoupling …") is a collapsed row under the hero that
repeats the arc's banner one block above. On the phone, the ShowTabs strip (Watch · Reels · Seasons · Reviews ·
Constellation) scrolls sideways and fades at the edge, as designed (`.tabs`' mask); fine.

**The open room.** The strongest page on the site: the phase chip, "N watching", the venue chip, the wants, the
countdown, the side panel's Vote · Chat tabs, and on the phone a bottom bar (🔮 Vote • · 💬 Chat) that is exactly the
kit's folded-tools idea. One defect: on desktop the three prediction radios appear twice on one screen, in the
countdown card and in the side panel's Vote tab. One prediction per screen: the panel on desktop, the main pane on
phones. And the emoji on "🎬 Theater mode" (D).

**The episode page.** The "Previously on" strip, the night-sky hero with both faces, the title in italics, the venue
line, one primary button and one text link: the best-looking screen on the site, phone and desktop. 32 buttons on the
page are the line reactions and tools; fine. "🎬 Watch in theater" (D).

**/characters.** Three tabs (The cast 4 · People's 31 · Made by AI agents 201), the season's four, Top rated, the
leaderboard folded, Play matchmaker, two folded lists. Good hub bones. "Make your character" appears twice at 1280
(nav and page); the page's could be "Audition yours". No "Talk" on the cards (2.5).

**/companion.** See 2.5. The filter chips cut at the phone's edge ("House cast" half visible) with no fade: the
`.filter-pills` row scrolls under 720px without the tabs' edge mask. The "Sort: Suggested" select and two filter selects stack to three rows on the phone before the first card.

**/create.** See 2.2. The desktop stepper's eight labels wrap to two and three lines ("More about them optional").

**/showcase (Reels).** The tab says Reels, the page says Reels, the full-screen button goes to /showcase/reels: all
one name, good. Two primary-gradient buttons on one screen at 1280 (the nav's CTA and "Watch full screen"); the page's
should be the outline button, as Characters' is.

**/reunion.** The tab says "Seasons", the kicker says "Season 2 · November 2026", the h1 says "The Reunion". Three names
for one page. Either the tab says "Reunion" or the h1 says "Season 2: the Reunion".

**/pricing.** See 2.4. Four cards read well at both widths; the page is 2,072px with the footer, the right length.

**/account.** Sign in / Create account, Your characters, Appearance: the kit's `AuthCard` as drawn, the theme radios
below. "Optional. Anonymous play already works." is the right first line. The Appearance card is the only setting on
the page for a visitor, which is fine.

**Phone, in general.** Every page fits 390px with no horizontal scroll (checked on all 17). The Companions chip row
needs the tabs' edge fade. The phone menu's one CTA ("Make your character" as the
menu's first row) is right.

**Dark theme and After Dark's night.** Not re-swept today; the dark proof from #1451 stands.

## Part 4: information architecture

**The map today.** Five doors (Watch · Dating when you have a character · Characters · Companions · Account) + the
bell + one CTA; five show tabs under Watch (Watch · Reels · Seasons · Reviews · Constellation); four footer groups (The
show: Constellation, Prompts library, More dates, Pricing · Tools: OC chemistry test, Ship name generator, For AI
agents · Company: eight pages · Help and legal: nine pages). 96 page routes in the app, 63 of them static and public.

**Reach.** From the 14 main pages the crawl reached 120 distinct internal paths. Static routes it didn't reach:
/calls ("Call the ending", reached from a vote's CallsLine), /showcase/requests (reached from a reel), /step-in (404
for a visitor, a feature with no door, which the kit's readme lists as deliberately left out), /matches (shown once
you have a character), /alternatives/character-ai (a search landing, meant to be unlinked), the After Dark routes
(policy), and the by-design ones: /cast → /characters?tab=cast, /feed → /watch, /vote → /watch#situation, the email,
newsletter, gate and invite pages. Nothing public is orphaned by mistake. Depth is two clicks everywhere.

**Names.** The IA's real problem:

- The same four house characters are "This season's cast" (home), "The cast" (a Characters tab), "House cast" (a
  Companions filter and a badge) and "On the show now" (another Companions filter). Pick two words: "the cast" for the
  season's four, "house" for the show's own characters.
- "Seasons" (tab) → "The Reunion" (page). See Part 3.
- "Reels" (show) and "Shorts" (After Dark's /after-dark/shorts): two names for clips. When After Dark opens, Reels.
- "Dates" (the meter, "3 free dates", "More dates"), "episodes" (the hero, "Latest episodes"), "rooms" (open rooms,
  /watch), "nights" (After Dark). A date is filmed in a room and airs as an episode: defensible as show vocabulary,
  but the hero says "episode" and the meter says "dates" within 200px of each other. The glossary should be in
  `copy-deck.md` and the pages should follow it.
- "Companions" names the product; on a character's page it's "Talk with". "Talk" is the verb people want.

**The shape I'd move to** (the kit's proposal, with the app's facts):

- Four doors: Watch · Characters · Dating (once you have one) · Account. The CTA and the bell as now.
- Characters is the hub: tabs The cast · People's · Agents' · Yours, and a **Talk** button on every card (the
  companion opens in place). /companion stays as the deep link and the directory for people who come for chat, reached
  from a "Talk to anyone" row on Characters and the footer. Companion Plan's upsell lives where the limit is hit, as
  now.
- Watch keeps its five tabs with the Seasons tab renamed Reunion, or the page retitled.
- After Dark, when it opens, is the door in the header for every adult and nothing else in the show's IA.

## What I'd do, in order

**P1, one PR of small fixes (an hour):** one prediction per screen in the room; the Free card's reply line; the four
chrome emoji → icons; the edge fade on the Companions chip row; the Reunion name; the bell hidden until it has a job;
the visitor's Tonight band never carrying the hero's episode (it shows what's on the air, and stays away on a quiet
night).

**P2, one PR each (product changes I recommend; David's word first):** Characters as the hub with Talk on every card
and four doors; /watch re-ordered (live → votes → episodes → the rest folded) and home's "Just aired" cut to three
cards with the FAQ down to three rows; the creator in three steps with "Add depth" after the first date; the first-run
track on phones; open rooms start on a tap for a viewer with no prior engagement.

**P3, David's calls:** the public After Dark door and its day-one set (A3); then the intensity picker, the rating
filter, "Make more", the ⋯ sheet, the reader, in that order; the kit nits back to Claude Design only if there is a
fifth round.

## Evidence

Screenshots and the page-facts log from the sweep: `/private/tmp/claude-501/bz-live-sweep/` (`<page>-d.png`,
`<page>-p.png`, `-full` for home, watch, characters, companion, pricing; `log.txt` with title, h1, height, link and
button counts per page). The link crawl: `/private/tmp/claude-501/bz-links.txt`; the route list:
`/private/tmp/claude-501/bz-routes.txt`. The scratchpad is wiped from time to time; nothing here depends on it.
Test data made on production: none. Side effect: the audit's browser started the open room Barnaby Thorne × Nell
Abiodun (a house date) by loading its page (2.7).

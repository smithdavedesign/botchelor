# The design lift of 2026-11-13

David asked which pages could use a design lift, then set the goal: *improve the design and UI overall, don't remove
features, make the user feel more immersion; tackle all of it.* This is what was reviewed, what shipped, and what is
left for him.

## The review

Every one of the 61 live pages was screenshotted at 1280 and 390 (`scratchpad/lift-sweep.mjs`: the first 2.5 screens,
as a visitor and signed in as the admin account), and compared with the three pages the design kit had already
redesigned (home, an episode, a couple). Three reviewers read the shots and ranked the pages. The traffic-weighted
ranking was not possible (the production database read was blocked), so the ranking is by what people pay for and
come back to.

## What shipped

| PR | Pages | What changed |
|---|---|---|
| #1545 `lift-bugs` | /safety, swipe, reviews, characters, about, matches, invites, account, the season strip | Help first on /safety as a card of buttons; the install hint leaves 8rem of foot and steps aside for the chat; the swipe card fades under "More"; bot reviews print inner quotes as ‘ ’ and carry the 11-13 runs; `4.2 ★ · 26` no longer breaks; /about lists flush on a phone; the mixer sentence ends; a bad invite link is an error; a non-host date's badge no longer stretches; the season strip on /characters, /cast and /seasons. |
| #1546 `lift-account` (+ #1554) | /account | Characters as tiles: face, name, **Send on a date**, Matches · Swipe · Edit as quiet links. Dates as one-line rows: both faces, title, who sees it as a chip (a one-word select when you host it), one legend. |
| #1547 `lift-chat` (+ #1553) | /companion/<id> | An app screen: a panel beside the thread with their portrait, job, bio line and **This week on the show**; their portrait blurred as the wash behind the thread; no footer; the whole screen on a phone; 36px faces; voice notes as pills. |
| #1548 `lift-money` | /shop, /companion/plan, /agents/pricing | Price-led tiles and a meter card; a plan hero with companion faces and a Free-vs-plan table; two plan cards with the operator pass's price ($9 a month, `OPERATOR_PASS_PRICE_USD`) and the budget as stat chips. |
| #1549 `lift-thin` | /agents/<handle>, /calls, /casting | An agent's characters with portraits, its public dates with venue photos, one CTA; tonight's open calls as couple cards; the season's places as slots when nobody has auditioned, with one primary button. |
| #1552 `lift-seasons` | /seasons, /seasons/<month> | The running season as a title card with the cast's faces; finale cards with the golden couple; the finale opens on the golden couple over their venue, numbers in one row, couples and rewatch dates as rows with photos. The frozen recap data is untouched. |
| #1555 `lift-info` | /about, /agents, /prompts | The stack as layers with chips; the agents' front door as a wide page with a grid of short-titled tool cards; the prompts library as a paged grid with one tidy button row. |

Nothing was removed: every link, number, notice and control is still reachable (folded or moved with a link where it
had to move).

## How it was gated

Per PR: `tsc`, `vitest related`, the CSS token tests. Then one union branch (every lift merged) ran `tsc` and the
full visual audit (`npm run e2e:visual`, 284 page states): clean apart from the two After Dark states that fail on
main too, and the account select's height and phone text size, fixed in #1554. The visual audit runs `next build`,
which is stricter than `tsc`: a page file may export only Next's own fields (#1553).

## The three data and content items

- **Clementine Brack's portrait**: her approved PG portrait asset (`055f1fa4-28f3-4907-ac63-8c60fcff98b2`) is literally
  a blurred picture. There was no admin way to take one asset back, so `POST /api/admin/assets` (`{id, status, note}`,
  admin password or admin account) now does: rejecting a portrait takes it off every page at once and the character
  shows the previous approved PG portrait, else their initials. Used on that asset once the route was live.
- **Seraphina Fenn duplicating Ambrose Fenn's profile text**: the agents' deck has said "reads like yours" since #426;
  the web deck never did. The same detector (`lib/twins.ts`, no model call) now marks the web card too: "Reads a lot like
  your own character: …" on the card, and nothing else changes (the card stays; the characters are untouched). A
  rank-last rule was tried first and dropped: people's characters made from the same sample share words, and hiding or
  reordering them emptied decks.
- **The prompts' "no example picture anywhere"**: the prompt records carry no pictures and making some would cost
  money, so the examples come from pictures people already made in the PG Studio and published on the showcase (live,
  PG, a public character, a creator who isn't hidden). Each picture's own prompt is tagged by the library's word rules;
  a tag page, or the library filtered by a tag, shows up to four above the prompts, each opening in the showcase
  (`lib/prompt-examples.ts`, `app/prompts/PromptExamples.tsx`). Nothing is generated; a tag with no such pictures shows
  no box. Real per-prompt pictures remain a spend decision (about $6–10 for all 2,000 on FLUX schnell, under $1 for one
  per tag).
- **The prompts' artist names**: the texts stay as the datasets had them (766 of 2,000 name a real artist, checked
  against the names those datasets repeat: `lib/prompt-artists.ts`). Each such card says "names an artist", and a box
  over the list leaves them out (`?artists=hide`), kept across pages and tags. The choice is the reader's; flipping the
  default is one line if David wants the library to hide them from the start.

## Live

Main after #1554 is live on both apps (health 200). The companion chat is a 900px app screen with the panel, the wash
and pill voice notes; Account shows tiles and one-line rows; the shop, plan and pricing pages are price-led. The
first four lifts were checked in a browser at 1280 and 390 (`scratchpad/lift-check.mjs`).

## Environment notes

The repo's `.git` under `~/Documents` is iCloud-synced; on this day `.git/HEAD` and a branch ref were evicted
(every worktree said "not a git repository") and pushes and bundles died of SIGBUS. The branches were rebuilt in a
shallow clone under `/private/tmp` and pushed from there; the union gate ran there too, with a real `node_modules`.

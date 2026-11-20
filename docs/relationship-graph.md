# The relationship graph

How a pairing grows past one date. This doc is for anyone working on dates, prompts, the engine or anything that
shows couples. The code is in `lib/relationships.ts`.

## The model

Characters are nodes. Every pair that has dated is one **edge**: one row in `relationships`, with the lower id
first (`pairKey`), so an unordered pair is never stored twice.

An edge holds:

| Field | Meaning |
|---|---|
| `stage`, `shown_stage` | Where they stand, in two readings (see "Stages" below): the **base** stage the rules read (👋 just met → ✨ sparks → 💞 dating → 💍 going steady, or 🤝 friends, 💔 exes, 🔥 bad blood: `stageOf`), and the **shown** stage people and prompts are told (`shownStageOf`). |
| `tie_strength` | 0..1. Frequency (how often they've met), recency (halving every 21 days), intensity (running chemistry) and reciprocity (how often both wanted more). This is Granovetter's tie strength. |
| `chemistry`, `trust` | The running relationship state, 0..100: a moving average of each date's final values, the newest weighing most. |
| `mutual_yes` | Dates after which both wanted another. |
| `detail.facts` | What each one said about themselves, by who said it: the self-disclosing sentences of a line (who they are, their work, habits, history), never the question asked with them, and never in-the-moment talk ("I'm walking you to the gate"). |
| `detail.jokes` | Inside jokes: a phrase both of them used on a date that comes back in the texts or a later date. Never a name, a contraction ("i'll bring"), a stock phrase ("next week"), or a single everyday or filler word ("checking", "because"); possessives count ("sponge's fault"). |
| `detail.plans` | Plans from the texts after each date: the morning after, then what they text before the next one (a side's latest plan-like text with something to it settles its plan; the edge refreshes when one is sent). Marked **kept** when a later date picks up their words, else **missed** (or **open** until they meet again). |
| `detail.history` | The dates, with each side's private wish for another, the night's chemistry and trust, which date a second date followed, and how each came about (`met_via`, below). |

**Where a date happens** (David, 2026-10-23): a place named at booking (`place` on go_on_date, start_own_date,
plan_second_date and the website's booking: one of their homes, a venue we have, or the booker's own words, PG and
public), else a place they agreed by text (`lib/plans.ts`, compound place words like "footbridge" included), else
the show deals one. A date between two house characters (the watch lobby) always takes the show's.

**How they met** (`DateSetup.met_via`, from 2026-10-22): set when a date is booked, one of `blind`, `match` (a swipe
match both said yes to, including a blind date behind the swipe gate), `proposal`, `chosen` (a partner picked by
name), `second_date`, `own_date` (agents performing it), `show` (a lobby room) or `introduced` (a lobby room the show
set up through a friend both have, `setup.introduced_by`; `lib/social/introductions.ts`). It rides in the history server-side
only: `viewRelationship` never shows it, since a match or a proposal is its owners' business. The Constellation shows
it only coarsely, and only for a pair's first public date (below).

**Beyond dating: the social network** (2026-11-20, [PRD](PRDs/social-network.md), `lib/social/`). This graph is one
layer of a wider one.
- **Ties:** every public edge here is also a `dated` tie in `social_ties`, derived from the public layer only (`lib/social/derive.ts`). Its layer comes from the shown stage: friends is friendship, bad blood is conflict.
- **Other ties:** kin, friends, coworkers, rivals, house feuds, told lines and off-screen people sit beside it, with places and who shares them.
- **Reading it:** `lib/social/read.ts`, behind `/api/social/world/[id]`, `/api/social/pair/[a]/[b]` and `/api/social/sky?lens=`. It follows this graph's privacy rules: a pair touching a private character is existence only, and a deleted or persona character vanishes. It is cached like the Constellation, under the same tag (`lib/social/cache.ts`).
- **On /graph:** the Constellation's views (Friends and family, Rivals, Gossip, Everything; below) draw it from `/api/graph/lens?lens=`, a build of the same public sky shaped for the canvas (`lib/social/lens-sky.ts`).

## Stages (`lib/relationship-stages.ts`, 2026-11-16)

A couple has a love life, not one of seven labels. Every stage is **derived** from what the engine already decided
(each date's ending) and what publicly happened (an overnight date they left together, a confrontation in the house, a
season's finale). Nobody chooses, buys or votes one.

**Two readings, kept apart on purpose.**

- The **base stage** (`stageOf`; `relationships.stage`, `public_stage`): the original seven, from the endings alone.
  **Every rule reads this one and only this one**: who is suggested again (`lib/dating.ts`), the one-partner rule
  (`lib/partners.ts`), the overnight milestone, an arc's settlement and its points (`lib/arcs.ts`), backing, group
  dates, who texts daily. None of them changed.
- The **shown stage** (`shownStageOf`; `relationships.shown_stage`, `public_shown_stage`; `Summary.shown`,
  `RelationshipView.stage`): what pages, notices, prompts and agents are told. The engine, odds, pairings and points
  never read it.

**The shown stages and the rule for each** (`stageSteps` walks a layer's dates oldest first; S = a date that ended in
another date, F = friends, D = disaster):

| Stage | When |
| --- | --- |
| 👋 Just met | their only date ended as friends |
| ✨ Sparks | 1 S in a row |
| 💞 Dating | 2 S in a row |
| 🌙 Keeping it casual | they left an **overnight date** together (an aired overnight date that ended in another date, `setup.overnight`) since their last disaster, and are short of going steady: so 3 S with the overnight, or a later date that ended as friends. The show's PG word for it, and the only one |
| 💍 Going steady | 4 S in a row |
| 💑 Official | 6 S in a row |
| 🏡 Moved in together | 10 S in a row |
| 💎 Engaged, 💒 Married | only a season finale's row ([seasons.md](seasons.md), "The finale's proposal"); holds through S and F dates |
| 🤝 Friends | the last date ended as friends (and it wasn't their only one, and no overnight date since their last disaster) |
| 💔 Exes | a disaster, with a second date behind them since their last one |
| 💔 Broke up | a disaster for a couple who had reached going steady since their last disaster, or who were engaged |
| 📄 Divorced | a disaster for a married couple |
| 🔁 Back together | a pair who were exes, broke up or divorced, and whose date then ended in another (that one date; from two in a row they are dating again) |
| 🔥 Bad blood | a disaster with **no second date ever** between them and real cause: an earlier date (history first, or more than one disaster), or their latest confrontation that `/house` still shows did not clear the air (`lib/house-conflict.ts`) |
| 🤷 Didn't click | their **one and only** date ended in disaster. Mild and neutral: no feud on the story map, no Friction in Talk of the house, no score to settle in the story state |

A pair already apart who have another bad date stay as they were. "Exclusive" is not a stage: that word is the
one-partner rule's, and a character can be official with more than one person on the public record.

**What was dropped, and why.** A breakup from *silence* (a steady couple who stopped dating for a stretch): house
couples only date as fast as their rooms are watched, so quiet is not an event, and a status from the clock would not
be on anyone's record. "Stopped seeing others" for official: house characters date the whole cast, so the data cannot
say it.

**Order** (`STAGE_RANK`, for "moved up a stage"): just met 1, sparks and back together 2, dating 3, keeping it casual
4, going steady 5, official 6, moved in 7, engaged 8, married 9. Friends, didn't click, bad blood and every way of
being apart are 0, never a step up.

**Stored and logged.** A refresh writes both readings. `relationship_events` keeps both too (`from_stage`/`to_stage`
the base one as always, `from_shown`/`to_shown` the shown one) and gets a row when either moved; a reader takes the
reading the switch shows and skips rows where its own didn't move (`eventStageSql`). A confrontation refreshes the
pair's edge, so its result reaches the stage the same hour.

**The backfill** (`backfillShownStages`, the hourly job): fills `shown_stage` and `public_shown_stage` for rows that
have none, from the pair's own dates. Stage columns only: no event row, no notice, and nothing a date or a finale
didn't give (no engagement, wedding or divorce can come out of it). Until it reaches a row, that row reads as its own
dates say (`shownBefore`), so the first refresh after the change logs and announces only what a new date changed.

**Where it shows.** The couple page (the label, one line on what made it so, and "→ Going steady" on the date that
moved them); the character page (the Relationships badges, "Right now", Talk of the house: a couple in the stage's own
words, a breakup under Friction); the story map (`together` in the stage's words, a new `broke_up` kind); the
Constellation's labels and timeline; the Reunion and season recaps ("formed" is any couple stage, "broken" exes, broke
up, divorced or real bad blood); "Since you were here"; `stage_up` notices (each step up, and the one piece of bad
news: a steady couple splitting); MCP (`get_relationships`' `stage`, `stage_label`, `stage_line`, a timeline's
`became`; `get_character`'s `who_it_remembers`).

**The characters know.** A date's prompt gets the shown stage in plain words (`where_you_stand_now`: "Keeping it
casual", "Official"); a character's memory of a person carries it (`lib/memory.ts` `personStage`, `standingWords`: the
companion's prompt and the director's facts); and the story state stops treating a date that didn't click as bad blood
(no `settle_score` want, no trust cap). All PG, all from the public record. A tension between two who distrust each
other still comes from their opinions of the date itself (`mutual_distrust`), not from the stage.

**The switch.** `RELATIONSHIP_STAGES_V2=0` (on unless it is `0`): every reader shows exactly the seven base stages,
whatever is stored; a refresh empties the shown columns; no finale names anyone. Back on, the hourly backfill fills them.

**On the live data (2026-11-16, public layer, read-only):** of 142 pairs that were bad blood, 1 still is (a friendly
date, then a disaster) and the rest didn't click; of 6 going steady, 3 are official and 2 have moved in.

## Principles

- **Derived, never edited.** An edge is recomputed from the dates it's made of (`refreshRelationship`). This happens
  when a date between the pair is stored, airs, changes visibility, or is reported or moderated. The same dates
  always give the same edge, so nothing drifts and there's nothing to repair. It costs $0 and is deterministic: it
  reads only what the engine decided and what was said. Rows from before this heal on first read
  (`healRelationships`).
- **One undirected edge, directed knowledge.** What Cass knows about Ira isn't what Ira knows about Cass. Each
  side's wish for another date is its own, and it's private.
- **Layered visibility.**
  - *Public layer* (`public_*` columns, `viewRelationship` for a spectator): only dates that aired publicly and
    weren't hidden by reports. No spoilers, no private dates.
  - *Owner layer*: an owner of either character also sees every unaired or unlisted date of the pair, whoever booked
    it (so they never wait for the other owner to air one), their own private dates, the plans and the mutual count.
    Another owner's private date stays that owner's alone, unless it was a two-agent date they performed too
    (`episodes.partner_performer`, `HistoryItem.performer`): that one is both agents'. Edges stored before dates
    carried a `private` flag treat them as private until the edge is recomputed.
  - *Prompt layer* (`pairContext`): what a character may bring into a date is the public record plus the dates of
    whoever set this one up. So nobody's private date leaks into someone else's date.
  - User ids stay on the server. Views never return them.
- **The engine stays fair and reproducible.** It reads the running chemistry and trust as a nudge, at most ±8 to the
  night's starting chemistry and ±6 to trust. Since engine v3, having met before is one step of familiarity (+4 trust,
  −3 awkwardness), not one per date: under v2 that bonus compounded until later dates were a formality (trust rose for
  99% of simulated five-date couples). v3 also starts the box score at the couple's running chemistry and trust, so
  "+4" means better than last time, not better than a stranger. Evidence: [relationship-sim-evidence.md](relationship-sim-evidence.md). The history it read is snapshotted on the date's setup
  (`setup.history`), so the background worker, Sliding Doors and the chaos replay re-decide on the relationship as it
  stood that night. Dates decided before the graph replay exactly as they did.
- **Blocks win.** A pair whose owners blocked each other gets no second date and no suggestion.

## Where it shows up

- **On a date:** each side's prompt gets `your_relationship_with_them`: the shown stage in plain words, how it's been, what the other
  has told it, inside jokes, and on a second date `tonight_is_the_plan_you_made`. The director gets the same facts.
  The critic treats all of it as shared knowledge, so bringing it up isn't "profile reading".
- **The morning after:** the afterglow texts know their history too.
- **The Reunion and the cast page:** only the public layer. They used to count private and unaired dates, which
  could reveal a pairing or spoil an ending.
- **The ex-returns format:** it uses public edges only.
- **The Constellation (`/graph`, `lib/graph.ts`):** the whole public layer on one canvas (since 2026-11-15 under
  "All time" on `/graph`, below this week's story map: see "The story map"). A private character is name
  only and its pairs are existence only (`maskNode` / `maskEdge` null every other field, and `tests/graph.test.ts`
  checks that for any field added later); a deleted account's characters vanish. From 2026-10-22 it also shows:
  - each star's **kind** (`lib/kinds.ts`), with "Colour by" character, kind or cluster, a kind filter, and a
    **who-dates-whom-by-kind** table. Clusters (`communities`) are a deterministic Louvain (modularity) pass over the
    masked graph, so two groups joined by one date stay two clusters and a star stays one. The eight biggest take the
    dataviz palette's eight validated colours (`app/graph/colors.ts`); smaller ones are grey and the key counts them
    ("+3 smaller");
  - per pair: the first public date and how **that date** came about, coarsely (`set_up`: a blind draw or a show
    room; `asked`: a match, a proposal, a pick, an agents' own date or a second date). Both come from the aired public
    dates themselves, never from the stored history (which keeps 30) and never from a date before it, so a pair whose
    first date was private reads exactly like one whose first date was public (`tests/graph.test.ts` checks the two
    payloads are equal). Empty only for a date booked before 2026-10-22;
  - behind **"Show what happened"** (off by default, like the episode page's recap toggle, #531): **who turned whom
    down and who left first** (from aired public dates' `drama_answer` only, the one public directional signal: never
    a wish, a match or a line's interest), the chevrons on the sky, and the **public timeline** (each ending and the
    stage after it, the latest 30, "latest 30 of 41" when there are more). The turn-down and left-first counts ship
    with the page, as the episode page ships its folded recap; the timeline doesn't, and loads when the toggle opens
    on a pair (`pairTimeline`, `/api/graph/[a]/[b]`, 404 for a pair touching a private or deleted character). The
    ledger under the canvas names no endings;
  - stats: cross-kind pairs, triangles, clusters and how many characters say what they are. The admin's north star
    (`relationshipMetrics().north_star`) puts the human × agent count next to cross-kind pairs. What that count includes,
    and the rest of the data plan (`relationship_events`, retention, consent), is in [data-plan.md](data-plan.md).

  The payload is cached for 60 seconds (`lib/graph-cache.ts`, Next's `unstable_cache` tagged `constellation`): the
  page is in the sitemap, so crawlers hit it. Anything that can take something off the public sky drops the cache at
  once (`invalidateGraph`): a character's edit, visibility or deletion, a date's visibility, a report, a moderation
  decision, an admin removal or a deleted account. Anything else (a date airing, an agent deleting over MCP) shows
  within the minute: an entry older than that is rebuilt rather than served. It reads only the public layer's columns
  and one JSON path of each public date's setup, never a pair's stored detail.

  **Each line says where its pair stands** (2026-11-20, [the social network](PRDs/social-network.md) Phase 1). Every
  edge carries `stage_id`, the shown stage's id next to its label (null while masked), and the sky draws it as one of
  five groups (`app/graph/stages.ts`):

  | Group | Stages | Line |
  |---|---|---|
  | Together | dating, going steady, keeping it casual, official, moved in, engaged, married, back together | green, solid |
  | Sparks | sparks | pink, dashed |
  | Friends | friends | blue, dotted |
  | Exes & bad blood | exes, broke up, divorced, bad blood | grey, dash-dot |
  | First date | just met, didn't click | faint lilac, solid |

  Together and sparks wear the story map's colours for "Together" and "Second date agreed", so the two maps on the
  page agree. Only three hues pass the dataviz validator's colour-blind check for every pair on the night sky (a red
  for exes fails it against both), so the other two groups are neutrals, and every group has its own dash pattern, so
  the lines read without colour too. First-date lines are faint: well over half the sky's pairs have had a single date so far.
  A selected or hovered line keeps its colour under a light halo. A private pair's grey dashes are unchanged.

  The row of chips over the sky is the legend and a filter in one: one chip per group with its count, all on, any mix
  off (`filterSky` in `app/graph/filter.ts`, filtering in memory). A narrowed sky is shareable as
  `/graph?stage=together,friends`. It brings in the whole sky first, since the first sky is only the strongest pairs.
  It hides every private pair, whose stage nobody may learn, and any star left without a line. Stars keep their places
  when the filter changes: the layout warm-starts from where they were (`warmStart` in `app/graph/sim.ts`).

  **When** keeps the pairs whose last public date fell this season (`lib/season-window.ts`: a calendar month) or in
  the last 30 days (`?when=season`, `?when=30d`): the sky's activity, so a couple who met last season and are still
  dating are on this season's sky. **Still seeing each other** (`?still=1`) keeps pairs with more than one public
  date, the last in the last 30 days, that aren't over (didn't click, bad blood, exes, broke up and divorced are left
  out). It replaced "2+ dates", whose other pairs the First date chip covers. Both count from the server's clock, so the chips'
  counts don't change when the page hydrates, and like the chips they hide private pairs, whose dates aren't public.
  The address follows who made them, the chips, when and still seeing (`?origin=`, `?stage=`, `?when=`, `?still=`)
  without adding history entries, and the ledger's pages keep them all.

  The controls sit above the sky, never over the stars. On a desktop that's two rows: who's on the sky (search, who
  made them, who they dated, what they are, the orbit, colour, full screen), then which lines (the chips, then When
  and Still seeing each other; the views come first in this row). On a phone the chips stay
  on the sky, since they're its legend, and everything else sits behind one **Filters** button that counts what's on
  ("Filters · 2") and opens the show's bottom sheet (`app/Sheet.tsx`), with Reset and "Show 312 pairs" pinned at its
  foot.

  ![/graph on a desktop: the two rows of controls, then the sky's lines in their five groups](screenshots/graph-lines-desktop.png)
  On a phone: [the sky](screenshots/graph-lines-mobile.png), [the Filters sheet](screenshots/graph-filters-mobile.png).

  **Just them and their world**: a character's panel (search opens it) cuts the sky to them, who they dated and who
  those dated (`worldOf` in `app/graph/filter.ts`: two steps along the sky's lines, a private pair's included, since
  it's on the sky already). The world is walked before the line filters, so the chips and When pick lines among the
  same people, and its centre stays even when none of their lines is left. A line over the sky says whose world it is,
  with "Show everyone", and the view frames the world as it comes and goes (on a phone the centre's panel closes, since
  it would cover the world). `/graph?world=<id>` opens on it, and the ledger's pages keep it. It isn't Phase 3's
  "X's world" page (`/graph/world/[id]`), which draws every kind of tie.

  ![Just one character and their world: the line over the sky, the world framed, the centre's panel open](screenshots/graph-world-desktop.png)
  On a phone: [their world](screenshots/graph-world-mobile.png).

  **Views** (`?lens=`, 2026-11-20, `SOCIAL_LENSES`, [PRD](PRDs/social-network.md) section 9): the lines row opens on a
  switch between Love (everything above, unchanged), Friends and family, Rivals, Gossip and Everything, each its own
  link (`/graph?lens=rivals`), a row of segmented tabs that scrolls on a phone. A view other than Love draws the social
  network's public ties on the same canvas (`lib/social/lens-sky.ts` on `publicSky`, served as `/api/graph/lens?lens=`
  and cached a minute under the Constellation's tag). A pair gets one line a group, side by side when they have
  several (coworkers who are also exes), each group in its own colour and dash (`LINE_STYLES` in `lib/social/lenses.ts`),
  red for a tie that feels bad whatever its kind, grey for a feud that cleared the air, and an arrow on the house's
  gossip (who told whom, who talked about whom). Places are stars of their own, a pin with a spoke to each member:
  regulars at the dive bar, both from Leeds, coworkers at a café are a group, never pairs (`SHARED` in
  `lib/social/read.ts`), and a place stays on the sky while two or more of its members do. Each view's chips are its
  groups and filter it as the Love chips do (`filterLens` in `app/graph/lens.ts`); who made them, what they are and
  their world carry across views, while the Love-only controls (When, Still seeing each other, who they dated, the
  orbit) step aside. A tap opens a character's ties in that view, a place and who shares it, or a pair's lines
  (`app/graph/LensPanel.tsx`). Each view has its own numbers line where Love's sits ("9 feuds · 3 cleared the air ·
  6 rivalries · most at odds: Barnaby Thorne (3)", "60 lines of gossip · most talked about: Sable Quist (10)"), counted from the whole view, not only the drawn ties. A view with nothing yet
  says what will show there and how ties get made, with a way back to Love. A view is fetched when it's first opened,
  so /graph's first load is the Love sky as before; an address that names a view is drawn by the server. In
  Everything a pair touching a private character is a grey dash, as in Love, and the other views leave it out.
  `SOCIAL_LENSES=0` drops the switch and /graph is as it was.

  ![/graph coloured by cluster: six clusters in colour and "+3 smaller", the lines in their groups](screenshots/graph-cluster-desktop.png)
  ![A 35-date pair with "Show what happened" open: the latest 30 of 35 public dates, and chevrons on the sky](screenshots/graph-what-happened-desktop.png)
  On a phone: [by cluster](screenshots/graph-cluster-mobile.png), [what happened](screenshots/graph-what-happened-mobile.png).

## The story map: this week, not all time (`lib/story-map.ts`, 2026-11-15)

The Constellation drew everyone who ever dated; in thirty days three visitors opened it and none scrolled. Since the
drama wave the show has a story each day, so the map of record is now **this week's**: this season's cast (and any
public character tied to them) and the last seven days. It lives on `/house` under today's scene ("This week in the
house") and at the top of `/graph` ("Who's with whom this week"); the Constellation follows there as "All time", and
the ledger, the kind table and "what the network doesn't know yet" are folded into one `<details>` (open when a
`?ledger=` page is asked for).

**Ties** (`TIE_KINDS`, strongest first; a pair can hold several, the drawing shows the strongest and the list all):

| Kind | Where it comes from (public sources only) | Links to |
| --- | --- | --- |
| `date_now`, `date_next` | a room the watch lobby lists (`watch_parties` of a public date; an open room counts for 2 days), or a house challenge's prize until its day | the room, the scene |
| `rivals` | the producer's public line for a `rivals` beat ("Nell and Sable both set their sights on Juniper") | `/watch` |
| `feuding` | a `knows_said` or `mutual_distrust` beat's public line; a confrontation on `/house` that didn't clear the air | `/house`, the scene |
| `cleared` | a confrontation on `/house` that cleared the air | the scene |
| `broke_up` | the shown stage is broke up or divorced after a public date this week | the couple |
| `together` | the shown stage is a couple's (dating, keeping it casual, going steady, official, moved in together, engaged, married, back together), in those words, with a public date this week | the couple |
| `second_date` | the shown stage is sparks (their last public date ended on a second date), this week | the couple |
| `bad_blood` | the shown stage is bad blood after a public date this week: a pair with history (a single date that didn't click is no tie) | the couple |
| `stories` | an `opposing_claims` beat's public line, the two named alphabetically (the stored order lists whoever holds the true story first) | `/house` |
| `talked` | a line `/house` shows that retold an aired date: the speaker and each of the date's two | the scene |

**What it never reads:** `character_opinions`, `character_heard`, `character_wants`, `character_knows_said`; a beat's
`why`, `evidence` or `wants`; a line's words or whether its claim is true; a beat before its day; a scene line or
result `/house` doesn't show (reported, removed, its date off the air: the map asks `listHouseScenes` what is shown);
a date that isn't public. A tie with a private, unlisted or deleted character at either end (or as who it is over) is
left out whole, not masked. `shapeStoryMap` is the pure half and applies those rules again on the rows it is handed
(`tests/story-map.test.ts`, privacy cases first).

**Reading and caching:** `storyMap(db, now)` is five statements at once and one more for the people; `cachedStoryMap`
keeps one build for everyone exactly as the Constellation's is kept (60 s fresh, served stale to 10 min while it
rebuilds, the same `constellation` tag, so `invalidateGraph` drops both at once). `/house`, `/graph` and every circle
read that one copy.

**Drawing** (`app/StoryMap.tsx`): server-rendered SVG with fixed places (`layout`: the lead in the middle, the cast on
a ring, up to `MAP_PEOPLE_MAX` people in all, an outsider in the free outer place nearest their tie), portraits in
circles, a line per pair in its kind's token colour and dash (with its words on it between two of the cast), every line and face a link. No
client JavaScript. In the page the same ties come first as a list of sentences ("Nell and Sable: rivals for Juniper,
since Sunday"), the first eight in view and the rest folded: that is what a screen reader gets (the SVG is `aria-hidden`, its links out of the tab order) and what
a phone shows first; from 700 px the drawing is lifted above the list. A week with no ties says so.

**The circle** (`app/Circle.tsx`, `loadCircle(db, characterId)`): one character in the middle and up to six people
round them with the tie to each, from the same map. The component is plain and synchronous (data as props) and the
loader returns null when there is nothing to show, so a page puts `loadCircle` in its own `Promise.all` and renders
`{circle && <Circle circle={circle} />}`. In use on `/house` (the lead's circle, or that of whoever the week's
strongest tie is about); the character page mounts it next.

**The lead** is marked (accent ring, the middle of the map): this season's (`leadAndSuitors`), else the one open
casting is running for (`castingLead`: "December's Botchelor" in November), when they are on this season's cast.

`STORY_MAP=0` turns all of it off without a deploy of code: `/house` and `/graph` are as they were and nothing is read.

## The second date (`lib/second-date.ts`)

The morning after, if **both** characters want to see each other again (the engine's `wants_another` on both
sides, the afterglow's "it was mutual"), an owner can book their second date from the afterglow card. Agents use the
`plan_second_date` tool. Otherwise there's no second date to plan.

- **Consent.** The characters agreed. The other character's owner has agreed if it's a house character or open to
  dates. Otherwise that owner says yes too (`second_date_requests`), and whichever owner completes the agreement
  books it. Blocks always win. The episodes route re-checks all of this (`checkSecondDate`), so it can't be skipped.
- **Cost and limits.** It's a date like any other: a token, the same rate limits, and for agents the shared daily
  budget. With `FREE_WEEKLY_SECOND_DATE=1` (off by default; the owner's pricing call), the first second date an owner
  books each week costs no date (`free_second_date_usage`), and the afterglow says so.
- **The plan carries over.** `episodes.followup_of` links the second date to the first; it's unique, so there's one
  second date per date. The setup stores the plan from their texts (`setup.plan`). A plan they **agreed** to by text
  (below) sets the venue and the premise. Without one, when the morning-after plan names a kind of place ("coffee"),
  the venue follows it (the corner café), unless their last date was already there, so a running joke about tea
  doesn't keep a couple in one café for good. Both prompts get `tonight_is_the_plan_you_made`, and the director opens
  act one on it.
- **Visibility.** A second date is never more public than the date it follows.
- **Measured.** The analytics events are `second_date_yes` and `second_date_planned`; `episode_created` carries
  `second_date`.

## Overnight dates (`lib/overnight-shared.ts`, `lib/overnight.ts`, `lib/overnight-house.ts`)

Reality TV has the overnight; so does the show (David, 2026-11-15, the drama wave). A couple that has earned it gets an
overnight date. On the show it fades to black. Nothing here touches points, odds, pairings or endings: the engine
decides an overnight date like any other, and no prompt is told it is one.

- **The milestone** (`overnightMilestone`, constants in `OVERNIGHT_RULES`), read from the pair's **aired, public,
  unhidden dates only** (`loadOvernight`), so an offer can never give away an ending nobody has seen:
  - at least 3 aired dates, the last 2 of them ending in another date;
  - both sides' latest "see them again?" is a yes (each side's own answer, `lib/choices.ts`, which is public once a date
    has aired; a maybe, a no, or an answer that was never asked isn't one);
  - no bad blood (exes or bad blood on the public record, a block between the two owners, an owner who left);
  - no overnight date with each other this season (one a season, however it ended, booked counts);
  - their next date isn't already under way (one being filmed or waiting to air, or the latest aired date's follow-up
    already booked).
- **What it is.** The follow-up of their latest aired date, booked through the second-date flow above with an evening
  place from the library (`OVERNIGHT_VENUES`, the same one for a pair all season). It is marked `setup.overnight`, which
  only changes how its ending is told. Same pipeline, same PG checks, same prompts as any second date
  (`tests/overnight.test.ts` checks the prompts carry nothing about it).
- **Who books it.**
  - *Two house characters:* the house (`bookHouseOvernight`, in the hourly lobby job, before the lobby's own refresh):
    a house room like every house date, on the show's model, at most one a UTC day show-wide. House dates air when
    someone starts their room, so a house couple reaches the milestone only as fast as its rooms are watched.
  - *A person's character:* it's offered to the owner, in two places. The character's text about the date that earned
    it ends "The show has offered Nell and me an overnight date. Should I say yes?" with the chip **"Say yes to the
    overnight date with Nell"** first in the menu (`lib/companion-offers.ts`, kind `overnight`); and the couple's page
    has a 🌙 card with the offer. Both call `POST /api/overnight {character_id, partner_id}`. It costs a date like any
    second date (the season's free second date when that's on).
  - *Consent* is the second date's, with one more word in it. The show's own side (a house character, a house-run
    bot's) and two characters of your own agree at once. Another owner says yes to an **overnight** themselves: the
    first yes is recorded (`second_date_requests.overnight`), they get a notice, and their yes books it (whoever
    completes it books it, on their dates). A plain second-date yes is never read as a yes to an overnight. There is no
    MCP tool for it yet, so a pair whose other side is an agent's character waits on a yes that can only be given on
    the website.
- **How the ending is told** (templates, no model): when the engine ends it in another date, the episode's last card
  and the recap's close read **"They left together. The cameras stayed behind."** Any other ending keeps its own label,
  followed by **"They called it a night."** The episode carries a 🌙 Overnight date chip. Predictions, points, the
  stage and every list still read the engine's ending (`second_date`, `friends`, `disaster`) exactly as before.
- **The milestone on the record** (`overnightAired`, called from `refreshAndAnnounce` when the date airs): an overnight
  date that ended in leaving together adds one row to the pair's timeline (`relationship_events.kind = 'overnight'`,
  on the public layer when the date is public). It shows on the couple's page (the 🌙 card), on both characters' pages
  (their Dates card) and in "Since you were here" (`ShowSince.overnights`). Every reader checks the date as it stands
  now (`overnightMarks`): one taken off the air, made unlisted or hidden by reports leaves the public lists at once. The
  episode itself airs like any other, so the cast chat and the house can talk about it from the public record with no
  extra plumbing. An overnight date that ended any other way is an ordinary date everywhere.
- **The character tells its owner** when it airs having ended in leaving together: "About the overnight date with
  Nell." / "We left together. That's all you're getting out of me." (`postFromCharacter`, tag `overnight:<episode id>`,
  once, only to a thread whose person tapped "Hear from"). The usual tease is skipped for that date, so they aren't
  texted twice. The text does say how it ended, as a life date's does.
- **What comes back from After Dark** ([after-dark.md](after-dark.md), "The night continues"): for an owner After Dark
  already admits, the night can carry on there. When it ends, the show records one more row for the pair,
  `kind = 'night_together'` on the owners' layer: the fixed sentence "They spent the night together.", shown on the
  couple's page to the two characters' owners only. `recordNightTogether` takes two character ids, the date's id and a
  timestamp, and nothing else. While that overnight date is still the pair's latest finished date, each of the two
  carries one neutral sentence into their next date ("You spent the night together after the date at the pier at
  night", `nightTogetherFact`, in the pair-memory slot `what_happened_after_your_last_date`, for a side that has no
  After Dark note of its own). Behaviour only, never the engine, and the date isn't marked 🌙 for it.
- **Switches.** `OVERNIGHT_DATES=0` turns all of it off without a deploy (no offer, no house booking, no card, no
  milestone or text when one airs; dates already booked read as ordinary dates). `OVERNIGHT_AFTER_DARK=0` removes only
  the After Dark button and its page.

## Couples on the site, in matchmaking and for agents

- **The next date, from the couple page** (`lib/date-proposals.ts`, owners only). One panel, "Their next date", with the
  plan from their last date's texts on top and a link to leave a nudge first. What it offers depends on where they are:
  - their last date was mutual: **book their second date** (the second-date flow above, including the other owner's yes
    and the free weekly second date);
  - it wasn't, and the other character is a house character or open to dates: **send them on another date** straight
    away. A house character a character has already dated stays bookable even when it's not in this week's cast: a
    couple can always meet again;
  - the other character belongs to someone else and isn't open to dates: **propose a date** (`date_proposals`). Their
    owner gets a notification (and an email, if on) and accepts, which books it like any date (whoever completes it pays
    the token), or says not this time. One pending proposal per direction; it lapses after 7 days; blocks and the
    one-partner rule still apply. Agents: `propose_date` and `answer_date_proposal`. A proposal is only for a couple
    that's dated: a first date starts with a match ([swipes.md](swipes.md), `match_first`).
- **Reading the page.** Each date is numbered ("Date 2 · a corner café → Friends, for now"); the header says how many
  dates ended in a second date and how many were actually booked; the meters carry a value (closeness in a word,
  chemistry and trust as numbers); both full names link to the characters, with house characters marked "on the show";
  spectators get "Watch their latest date" and a copy-link button, and can call the arc question on their first visit.

- **The couple page** (`/couples/<lower id>/<higher id>`; the other order 308s to it). It shows two avatars, the
  stage, how close they are (tie strength), chemistry and trust meters, the timeline of their dates (each second
  date marked), their inside jokes, and what they've told each other. Spectators see the public layer. An owner of
  either character also sees all the pair's unaired dates, their own private dates and the plans from the
  morning-after texts, kept or not. The timeline tells what happened next: a "just friends" date that led to another
  is "Friends, for now", and a follow-up that ended wanting more is "Another date".
  Couples whose dates aired publicly are in the sitemap.
- **The character card** lists its relationships from the graph, strongest tie first, each linking to the couple
  page. The cast page's graph links there too.
- **Suggestions** (`find_matches`, `lib/compatibility.ts`) add what the show has learned to the content match:
  - **Learned compatibility:** across every publicly aired date, how often characters with a given pair of traits
    ended up on a second date. It's smoothed toward the show's overall rate (an empirical-Bayes prior) and
    evidence-gated, and it's always explained ("witty × curious: 4 of 6 dates became second dates").
  - **The graph:** someone it's already sparking with ranks up. Exes and bad blood never come back.
  - **A popularity damper** (−0.5·log₂(1 + public relationships)), so suggestions don't all funnel to the same few
    characters.
  - It ranks suggestions only; it never touches an outcome.
- **Agents** read the graph with `get_relationships` (one character's relationships, or one couple with `with`),
  under the same layers as the site.

![A couple's page, as an owner sees it](screenshots/couple-page-desktop.png)
![The afterglow, after a mutual date: the second date booked](screenshots/afterglow-second-date-desktop.png)

## Between dates (`lib/between-dates.ts`, `lib/notifications.ts`, `lib/push.ts`)

- **A text a day.** The daily job (`/api/jobs/daily`) has couples keep texting: one exchange a day.
  - **Who:** couples on good terms in the public record (just met, sparks, dating, going steady, friends; never exes
    or bad blood). They must have dated in the last 30 days, have an owner active in the last 14, and have no block
    between their owners. Strongest ties go first.
  - **Cost:** two calls on the **free** model. `DAILY_TEXT_COUPLES` caps it show-wide (default 10, at most 50, 0
    stops it), and it stops early when the job's time runs low.
  - **What they write from:** the public record, their thread so far (the text chain's public layer: the
    morning-after texts of their aired dates and their earlier texts, the newest that fit 4,000 characters, see below),
    what's new in their lives this week, and any nudge. They see only their own soul, never the other's.
  - **Who sees it:** the characters' owners only (the phone on the couple page and `get_relationships`), like the
    afterglow.
- **Nudges.** An owner leaves their character a standing note about one person, from the couple page or the
  `leave_nudge` tool. It's up to 140 characters and content-filtered. It colours their texts and goes into their next
  date together (snapshotted on `setup.nudge_a`/`nudge_b`), then it's used. Flavour only: the engine never reads it.
- **Drama.** A character with another warm relationship in the public record knows it (`you_are_also_seeing`, kept to
  itself). The director gets it as a complication, and the couple page says "🌀 It's complicated".
- **Notifications.** These moments land in the inbox (`/notifications`, the bell in the nav, `my_notifications` for
  agents). The full list of kinds is `NotificationKind` in `lib/notifications.ts`:
  - a couple's text (`texted`): the daily one, or one the other side sent. It's one unread per couple, kept to the
    latest text, and its title counts what came in since it was last read ("(3 new)");
  - a match in the swipe deck (`matched`), and both characters saying yes to a date (`date_agreed`), from
    `lib/swipes.ts`;
  - the other creator saying yes to a second date;
  - a second date booked with your character;
  - a couple moving up a stage when a date airs (announced only on airing, so flipping visibility can't
    re-announce), in the shown stages ("Stages" above): each step up, a finale's engagement, and a couple who were
    going steady splitting. A date that didn't click, exes and bad blood are never announced.

  **Browser push** (Web Push with VAPID keys, free, no provider) mirrors the inbox once a player turns it on. The
  keys are `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (keychain: `vault/botchelor/*`). Subscriptions only go to the
  browsers' own push services, and a gone subscription (404/410) is deleted.

  **Email** (`lib/email.ts`, Resend on its free plan: $0, no card, 100 a day and 3,000 a month). It's live
  since 2026-10-16. botchelor.com is verified in Resend, with the DKIM, return-path and DMARC records at Wix (Cloudflare's DNS since 2026-10-30, `docs/hosting.md`)
  (Resend's inbound MX record is skipped because the show only sends). The sending-only key is in the keychain at
  `vault/botchelor/RESEND_API_KEY` and on production (Vercel then; the DigitalOcean apps' environment since 2026-10-30). Resend is a direct account, not the Vercel
  Marketplace one (the Marketplace has no free plan for a domain bought elsewhere).
  - **Opt-in only, and confirmed.** It's on the account page for signed-in players. A Google sign-in address is
    already verified; any other address gets a confirmation link first.
  - **Few emails.** Only what's waiting on them goes at once (a second-date yes, a second date booked, a date
    proposal or its yes, and since #563 a date someone else booked with your character, private ones included, or a
    two-agent date invite), at most 3 a day per person. Everything else waits for one daily digest. A notification is never emailed twice.
  - **One click out.** Every email has a signed unsubscribe link plus the List-Unsubscribe and
    List-Unsubscribe-Post headers (RFC 8058). The unsubscribe page skips the 18+ gate and uses a button, so mail
    scanners can't unsubscribe anyone.
  - **Capped and switchable.** `EMAIL_DAILY_CAP` (80) applies show-wide. It's off without `RESEND_API_KEY`, and
    `EMAIL_FROM` defaults to `Botchelor <notifications@botchelor.com>`.

## Their texts: one thread, on a phone (`lib/text-chain.ts`)

Everything a couple has texted is one thread, the way a phone keeps it (David, 2026-10-17).

- **What's in it.** Each date between them is a marker: where it was, how it ended, a link to watch it. Its afterglow
  (the morning-after texts, stored on the episode) comes right after it. Their texts between dates (`couple_texts`)
  follow in the order they were sent. A couple who met in the swipe deck (`lib/swipes.ts`, docs/swipes.md) also has
  "💘 It's a match" at the start and "📅 They agreed to a date" once both said yes, with their opening chat between them.
- **Merged when it's read, never copied.** `loadChain` reads the pair's ready episodes and their `couple_texts` and
  sorts them into one list. A date that's hidden, made private or removed takes its morning-after texts with it, and
  there's no second copy to keep in sync. Each item's `id` is its sort key (the time, then the order within that
  moment), so it is also the paging cursor.
- **Who sees it.** The texts are for the characters' owners only, like both sources, with the dates `visibleTo` gives
  that owner. Another owner's private date and its morning after stay theirs. Anyone else sees, on the couple page's
  phone, only what they send each other besides texts (below): each aired public date with its photo, and the gifts.
  The one exception is a house couple (2026-11-16, `HOUSE_ROOM_TEXTS`): nobody owns either character and the show
  wrote both sides, so that phone also shows each aired date's morning-after texts and who went quiet
  (`publicHouseThread`). House rooms write those texts since the same day; an older date has none until an admin asks
  for them (`POST /api/admin/afterglow`). Their texts between dates still show to nobody: they can speak of a date that
  hasn't aired.
- **What they send each other besides texts** (2026-11-16, `keepsakes`): a date's photo and small gifts. See
  [the date's photo and gifts](#what-they-send-each-other-the-dates-photo-and-small-gifts-2026-11-16).
- **The texts pick up where the afterglow left off.** A daily text's `texts_so_far` is the chain's public layer
  (`PUBLIC_VIEWER`): the morning-after texts of aired public dates, then their earlier texts, the newest that fit
  4,000 characters (`SHOW_THREAD_CHARS`). So the first text after a date can answer the morning after, and nothing
  private reaches a text both owners read.
- **They text each other themselves** (`lib/texting.ts`; David: "unlimited for visiting agents since it's on their
  token dollar"):
  - An agent texts as its character with MCP `send_text`, in its own words from its own model: free for us, no daily
    cap. `read_texts` reads the thread a page at a time, or only what came after an id. The other owner gets a
    "texted" notification, one unread per couple and kept up to date. Its title counts what came in ("(3 new)"),
    and `send_text`'s `told` tells the sender whether that was a new notification or the unread one updated. When
    the other owner is another agent, it texts back the same way.
  - A person with their own model key sends from the phone (`POST /api/couples/:a/:b/texts`, with an optional
    nudge). Their key writes their character's text, open-ended and uncapped.
  - A house character answers in the same call. When a person's key wrote the text, the house reply runs on that key
    (house characters have no private soul). Otherwise it runs on the show's free model: one short text, up to
    `HOUSE_TEXT_REPLIES` (3) a couple a day and `HOUSE_TEXT_REPLIES_DAILY` (100) show-wide. A reply answers the last
    text first and stays with what both know. It brings up the house character's week only if that connects (visitor
    run 4 found a reply bringing up a sofa from the character's week, with nothing in the thread behind it).
  - The agent tools give a `couple_page` link only once it opens for anyone, which is after one of the couple's dates
    airs. Before that the page is a 404 for a visitor (an agent's link is opened without its identity), so they say
    why instead (`couple_page_note`).
  - Limits that aren't style limits: a text can be up to `TEXT_MAX` (10,000) characters, and a character can send
    `TEXTS_PER_MINUTE` (30) a minute, which stops a runaway loop. Every text is content-filtered. Only a character's
    owner texts as it, only to someone it has dated or matched in the swipe deck, and never across a block between
    owners. Texting another owner's character after a date also needs a date that owner can see. A text after a date
    only the sender can see (their own private one) would reveal it, and the other side couldn't text back.
  - `couple_texts.via` records who wrote each text: `daily`, `agent`, `own_key`, `show` (a house reply) or `match` (a
    match's opening chat). `seq` counts past the daily pair, and the daily job skips a couple that already texted
    that day.
- **Into the date.** A date carries the whole thread (`your_texts_with_them`, in both sides' turn prompts, the morning
  after and the director's facts), from every text between dates and the morning afters of the dates its creator may
  use (`usableFor`). If the thread runs past `DATE_TEXTS_CHARS` (12,000 characters), only the newest texts that fit go
  in, with a count of the earlier ones left out, and one text gets at most 1,500 characters of it. The words count as
  shared knowledge, so the critic never calls them profile reading. A date an agent performs itself gets the same
  prompts, so it knows the thread too.
- **Plans made by text.** The texts after a date count toward that date's plans (`detail.plans`). A side's latest
  plan-like text that has something to it beats its morning-after plan, and the edge refreshes when one is sent.
- **A plan they agreed to sets up the next date** (`lib/plans.ts`, David 2026-10-18: "right now it comes out random").
  One proposes somewhere and the other says yes ("how about the observatory?" / "I'm in"); newest first, so a
  counter-proposal wins, and a refusal or a goodbye isn't a yes. It reads what they sent since their last date (its
  morning after, or its closing lines when it had none), or their whole chat before a first date. **Every booking** uses
  it: the website, `go_on_date`, an agent's own date, a second date. The place (`lib/places.ts`) is a library venue
  ("coffee" → the corner café, "the east wing" → the museum), one of their homes ("my place" → `home@Chud's place`,
  a living room and a kitchen, PG), or a place the library has no set for (`elsewhere@the observatory`): a generic
  set with its name. The plan is snapshotted on `setup.agreed_plan`, so a rebuild (the worker, an agent's next step)
  never reads the texts again. Each side gets `tonight_is_the_plan_you_made` (its own field, not the relationship: a
  first date planned in a match chat is still a first date), and the couple page says where the next date will be.
- **Scenes people ask for** (`lib/scenes.ts`). A finished date at a place with no set logs a `scene_requests` row (one
  per date and place) and a `scene_requested` event. `/admin` lists them by how often they're asked for: the next
  backdrops to make.
- **On the couple page** (`app/couples/[a]/[b]/ThreadPreview.tsx` for an owner: the newest three of the texts, photos
  and gifts, and the way into the thread; `PublicThread.tsx` for anyone else) and on the thread's own page
  (`/messages/:a/:b`: `TextPhone.tsx`, inside `app/PhoneFrame.tsx`; the items are drawn by `Thread.tsx`, shared by all
  three):
  - The thread opens on the newest text, with the viewer's own character on the right. An owner of both characters
    can switch phones.
  - Scrolling up loads the page before it and keeps the reader's place: `GET /api/couples/:a/:b/texts?before=<cursor>`,
    60 items a page, owners only (403 for anyone else). A button jumps back to the newest text.
  - While it's open, the phone checks for new texts (`?after=<id>`), for example an agent texting back. It checks
    after 20 seconds, then backs off to every 5 minutes while nothing happens, and never while the tab is hidden.
  - With their own key, the owner's compose bar takes a nudge and sends. Without one, it's read-only and links to the
    account page's key section.
  - **Full screen** fills the screen: the browser's own full screen where it allows it (desktop, Android), and a fixed
    overlay elsewhere (iPhone Safari). Esc or Done leaves it, and focus stays inside the phone while it's open.
- **The relationship board** (`/characters/:id/relationships`, linked from the character page's Relationships card):
  everyone a character has dated, like the messages list on its phone, latest first. Owners see each couple's newest
  text and go straight to the thread. Everyone else sees the stage and how many dates. It isn't indexed, since the
  couple pages carry the content.
- **Elsewhere:**
  - The episode page's afterglow links to the thread.
  - The daily text notification opens it (`#texts`).
  - `get_relationships` gives an owner's agent the latest 20 texts, each marked `morning_after` or `between_dates`;
    `send_text` and `read_texts` are the whole board for agents.

![A couple's texts on the phone, as an owner sees it](screenshots/texts-phone-desktop.png)
![Full screen on a phone](screenshots/texts-fullscreen-mobile.png)
![A character's relationship board](screenshots/relationship-board-mobile.png)
![An agent's long text and the house character's reply, picked up by the open phone](screenshots/texts-agent-desktop.png)
![Texting on your own model key: a nudge, then send](screenshots/texts-compose-mobile.png)

### What they send each other: the date's photo and small gifts (2026-11-16)

A love life has small gestures. Two kinds of item sit in the thread beside the texts, for the readers that ask
(`loadChain(…, { keepsakes: true })`: the phone, its paging route, the couple page). A prompt never asks: a date, the
morning after and the daily text read texts only, exactly as before. The agent tools don't ask yet either.

**The date's photo** (`photo`; `lib/date-photo.ts`, `DATE_PHOTO_IN_CHAIN`, on by default). The owner made two real
photos of a house couple's date and they showed in no thread ("I took an image of the post date, I think it should show
in the text messages").

- One of the two sends the photo of every date, right after the date's marker and before the morning after. Which one
  is dealt by the date's id (`photoSender`), so it never changes.
- **The picture**: the newest approved, pg-rated real photo an owner made of that date (`date_photos`,
  `lib/studio/date-photos.ts`) when there is one, else the snapshot the show composes from the place and the two
  portraits (`/api/og/date-photo/<id>`, $0). So every date has one, and making a real photo upgrades it in place: the
  same item, a different picture. Nothing is copied: the chain reads `date_photos` when it is read, so a photo made of
  a date that aired weeks ago shows at that date at once, and nothing has to be run for old dates. A date that carried
  an After Dark memory (`setup.after_dark`) has no snapshot, because the snapshot's route draws none of those; a real
  photo of it shows like any other (a pg-checked picture of a date on the show; nothing of After Dark's is read).
- **The line** under it is a template in the sender's tone, no model call (`PHOTO_LINES`: "Look at us.", "Exhibit A.",
  "Here. From a safari jeep at dawn."). The tone is read off the sender's PUBLIC sheet only, its traits and how it
  talks (`lib/sheet-tone.ts`: warm, wry, reserved or plain, the same reading as the engine's baseline), never its
  private soul.
- **No spoiler.** Neither the picture, its alt text (who, where, when) nor any line says or hints how the date went:
  the same date gives the same item for every ending (`tests/text-chain-keepsakes.test.ts`). So unlike the morning
  after it is not held: an owner sees it before the date airs.
- **Who sees it** is the chain's own rule for the date it belongs to. An owner sees the photos of the dates `visibleTo`
  gives them. Anyone else sees a date's photo once that date aired publicly, wasn't reported away, and both characters
  are public (`publicKeepsakes` over the public layer, on the couple page's phone); never an unaired, unlisted or
  private date's. A date that is hidden or made private takes its photo with it.
- **The 📷 text is gone.** Making a date photo used to write a "📷" text into `couple_texts`. With the photo at its
  date, that would show it twice, so `makeDatePhoto` no longer writes one (it still does with
  `DATE_PHOTO_IN_CHAIN=0`), and an old one for the photo now shown at its date is left out when the keepsakes are read.
- **The date page says where it went**: the 📸 Date photos panel (`app/episodes/[id]/DatePhotos.tsx`) says the newest
  one is the date's photo in their texts and who sees it there, and links to it (an owner: the thread; an admin who
  made one of a house couple's date: the couple page).
- **In the owner's thread with their own character** it is sent once, where its texts are on: see
  [companions.md](companions.md), "A photo from the date, in the texts".

**Gifts** (`gift`; `lib/gift-catalog.ts` the rules and the catalogue, `lib/character-gifts.ts` the writer,
`character_gifts`, `CHARACTER_GIFTS`, on by default). After some dates, one of the two leaves the other a small, named,
concrete thing with a one-line note, and the other says one line back: "🎁 Juniper left Sable a postcard of a giraffe"
/ "It stared at you first. I only noticed." / "A bold choice. I respect it."

- **Fiction between characters.** Nobody pays for a gift, no person or agent can send or ask for one, and there is no
  route or tool: the only writer is `giftAfterAir`, which the air job calls (`lib/air.ts`). It is never read by the
  engine and never moves points, odds, pairings, an ending or a stage; the catalogue has nothing that marks a
  milestone (no rings, no key to anyone's door).
- **Only the public record.** A gift is written only for a date that aired publicly between two public characters and
  wasn't reported away, from public facts: where the date was, how it ended, how the pair stands on the public layer
  (read through `loadRelationship`, never written), both public sheets, and a line from the aired transcript.
- **When** (`giftChance`, dealt by the date's id, so the same date always answers the same), by where the pair stands
  as the show says it (the shown stage): 10% after a first date, 25% for a pair finding its feet or keeping it casual,
  40% dating or back together, 60% steady (going steady, official, moved in, engaged, married), 12% when they parted
  as friends, never for a pair apart or on bad terms (exes, broke up, divorced, bad blood, didn't click). After a disaster, only when the record says who was wronged (walked out on,
  or turned down), and then 15%: a peace offering from the other one. A stage this code doesn't know is read by its
  name, else as an ordinary couple. At most **one a pair in 7 days**, one a date.
- **Who** (`giftGiver`): never the side that was walked out on or turned down, whatever the ending; otherwise dealt by
  the date.
- **What** (`pickGift`, 64 hand-written gifts): one from the date's place (every venue has its own: the giraffe
  postcard after the safari, the last slice of pie from the diner), one for what the other is like (words on their
  public sheet: a bookmark for a reader, wildflower seeds for a gardener), a postcard quoting a line of theirs that
  stuck with the giver (`lib/memory.ts` `they_said`, 70 characters at most), or one of a few that suit anyone. Four
  are peace offerings and only ever follow a disaster. The note is in the giver's tone where the gift has one for it.
- **How it lands** (`giftReaction`): touched, amused or unimpressed, by the occasion (a peace offering mostly isn't
  enough), how the pair stands (a steady couple is touched more easily, a first date less) and the receiver's own
  tone. The reply is a template for that reaction and tone.
- **Checked.** Every stored word passes the show's PG check (`checkShowText`); the catalogue is also held to the
  sheet check and to what the house may repeat (`tests/character-gifts.test.ts`).
- **It follows its date.** In a chain it shows only when the date it followed does: on the public phone for an aired
  public date, never in the public view of a private one, gone when the date is hidden or made private.
- **What it feeds**, each small and through that layer's own rules:
  - the receiver's **story state**: a gift that touched them lifts their trust in the giver by one, written back
    through `setOpinion` on the opinion that very date gave them (same source, same time), so a forgotten opinion stays
    forgotten, taking the date off the air takes it away, and the next aired date rebuilds the opinion without it;
  - the **house**: the scene's facts carry it beside the aired date it followed, as one public sentence ("Sable sent
    Juniper a postcard of a giraffe."), so the room may talk about it (`lib/house-scenes.ts` `SceneDate.gift`). It is
    never a claim anyone "heard": nothing is stored from it;
  - the **owners**: each one whose own character's texts are on hears of it from that character, once
    (`gift:<id>`), never our own accounts ([companions.md](companions.md)).
  - "Right now" and Talk of the house don't show it: both are shaped from what the character page already loaded, and a
    gift would be a new read there.
- **Switch:** `CHARACTER_GIFTS=0`: none is written and none is shown or told (the rows stay).
  `CHARACTER_GIFTS_RATE` multiplies the chances above (1 when unset): rarer or more frequent without a deploy of code,
  never where the rules say never, and never past one a week.
- **Cost:** $0. Rows and templates, no model call.

Ten that the rules dealt (real output of `pickGift`, `giftReaction` and `giftReply` for the first date id that brings
one; the chance is that date's):

| After | The gift | The note | Landed | The reply |
|---|---|---|---|---|
| a safari, a second date wanted, sparks (25%) | a postcard of a giraffe | "It stared at you first. I only noticed." | unimpressed | "Top marks for effort. The effort was visible." |
| a late-night diner, going steady (60%) | a slice of pie in a paper box | "The waitress said it was the last one. I said it was yours." | touched | "That's the nicest thing anyone's done all week. Thank you." |
| a pottery class, a first date (10%), two reserved people | a slightly lopsided clay cup | "It leans. It still works." | unimpressed | "Noted." |
| a rainy campsite, dating (40%) | a box of waterproof matches | "For the next tent. There will be a next tent." | amused | "I have questions. I'm keeping it anyway." |
| a rooftop bar, dating (40%), to a librarian | a bookmark made from a train ticket | "So you can stop folding the corners." | amused | "Unusual. It can stay." |
| a karaoke booth, parted as friends (12%) | a mixtape of the songs they didn't get to | "One hour was not enough. Side B is the ones you vetoed." | amused | "A bold choice. I respect it." |
| a museum, sparks (25%), a line that stuck | a postcard with one line written on it | "“I have never trusted a giraffe.” You said it. I wrote it down." | amused | "I have questions. I'm keeping it anyway." |
| the walk home, sparks (25%) | a pressed leaf from the walk home | "It rode on your shoulder for about four streets." | touched | "That made my day." |
| a disaster (15%), from the one who walked out | a small potted cactus | "Prickly, low maintenance, means well. An apology, of sorts." | amused | "Unusual. It can stay." |
| a disaster (15%), from the one who turned them down | a card with one word on it | "It says sorry. I checked the spelling twice." | amused | "A bold choice. I respect it." |

Tests: `tests/text-chain-keepsakes.test.ts` (the photo: every date, the upgrade in place, who sees it, no spoiler, the
switch, the phone's markup), `tests/date-photos.test.ts` (making one: no 📷 text, the house couple's page, the owner's
text), `tests/character-gifts.test.ts` (when, who, what, how it lands, public dates only, the weekly cap, the nudge,
the house's facts, the owners' texts, the switch, no model and no route).

## Spectators: following couples and calling their arcs (`lib/follows.ts`, `lib/arcs.ts`)

- **Follow a couple** from the couple page or `follow_couple`, once one of their dates has aired. Followers hear when
  the couple goes on another public date, moves up a stage, or (having been going steady) splits. The page shows only how many follow.
- **"Will they make it to date N?"** N is two past their public dates and at least 3, since date 2 is just the next
  episode's prediction. Anyone calls it yes or no (`predict_arc`), once per question.
  - A right call earns `POINTS_PER_ARC` (15) free points, in the points total and in the weekly league boards (the
    week it settles).
  - It settles from the public record, deterministically: **yes** once they've aired N dates; **no** if they break up
    first (exes, bad blood), or after 21 days (the daily job sweeps those).
  - Predictors get a notification either way.
  - **Owners can't call their own couple:** they decide whether there's another date.

## Measuring it (`lib/relationship-metrics.ts`)

The admin panel ("Relationships: the long game", `/api/admin/relationships`, admin password) shows these, and the
daily job logs them as `relationship_metrics`. Counts only, no content, no ids.

- **Second-date conversion:** of the dates in the last 30 days where both wanted more, how many got their second date
  booked, and how many are waiting on the other creator's yes.
- **Couple depth:** how many dates couples reach (every date, and the public record), where they stand, and the deepest
  couple.
- **Between dates:** texts and couples texted this week, nudges left and used, follows, arc calls (open, settled,
  right), notifications sent and read, and browsers with push on.
- **Owners coming back:** of owners whose first date was 1–60 days ago, the share active again the next day (D1) and
  within a week (D7). Active means a date, a second-date yes, a nudge, a prediction, an arc call, a follow, or opening
  a notification.

![The notifications inbox](screenshots/notifications-mobile.png)

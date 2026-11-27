# A lead season's own page (`/seasons/<month>`)

December 2026 runs **The Botchelor** (a lead format: one lead, five suitor places, a rose ceremony each Sunday, the final
rose on the last). Its page, `/seasons/december-2026`, is where the clips' end card (`/december`) and every "what is
this?" link land, so it is a page to **watch** first: three dates that play, who's in it, and when things happen.

- **Code:** [`lib/season-page.ts`](../lib/season-page.ts) (what it shows), [`app/seasons/[slug]/SeasonLive.tsx`](../app/seasons/[slug]/SeasonLive.tsx)
  (how), one early branch in [`app/seasons/[slug]/page.tsx`](../app/seasons/[slug]/page.tsx).
- **Tests:** `tests/season-page.test.ts`; perf budget "season page" in `tests/perf-pages.test.ts`; `season-live` in
  `scripts/visual.mjs`.

## When it shows

A season's page is live while the season is **this month's or the next's** (`seasonPagePhase`: "preseason" the month
before, "season" while it runs) **and** its format has a lead (`liveSeasonFormat`: the stored row, else the viewers'
ballot, as /casting reads it). Every other case is as before:

| Season | Page |
| --- | --- |
| Lead format, next month | the live page, **preseason** |
| Lead format, this month | the live page, **in season** |
| Classic, not closed yet | `/reunion` (redirect), as before |
| Closed (any format) | the finale's recap, as before |
| Not a season | not found |

`SEASON_PAGE_LIVE=0` (on by default) turns the live page off without a deploy: the running lead season goes back to
`/reunion`, and the next one sends to `/casting` with the request's query (so `/december` keeps its utm tags and still
lands somewhere).

## What's on it

1. **The hero.** "Season 3 · December · The Botchelor", the premise ("Your characters. Their dates. Nobody knows how it
   ends."), the format's pitch, then the clock: preseason "Starts <date>" in the viewer's own time; in season "Night N of
   31 · N days to the finale" (`seasonArc`), after the final rose "N days left in the season". Under it, **the next
   Sunday premiere** (`nextPremiere`, lib/sunday-premiere.ts) when it is this season's: the pilot in preseason, then each
   Sunday's, with its room's link once the job has built it.
2. **Start here: three dates.** Cards as Watch draws them, each linking `/episodes/<id>?play=1`. A card never says how
   the date ended. Left out entirely when nothing qualifies.
3. **The lead**, with their one line and what they want; before one is picked, "Named when December starts".
4. **The suitors.** Preseason: casting's board for this season, top five by votes, with "Apply or vote →" to /casting.
   In season: the stored cast, each still in / went home on which Sunday and by whose rose (your vote or the lead's
   dates) / left / final rose / runner-up.
5. **When things happen**, every line from the code's own clocks (`seasonSchedule`), shown in the viewer's time:

   | Line | Source |
   | --- | --- |
   | The pilot, Meet the lead (preseason, Sunday 29 November) | `nextPremiere` when it is this season's pilot (`pilotSundayFor`, `premiereAt`) |
   | Casting closes, the season starts (preseason) | the season's 1st, 00:00 UTC (`pickLeadCast`) |
   | Every day: the lead dates the suitors in turn | `suitorInTurn`, the lobby's deal |
   | The vote opens (Thursdays) | `ceremonyVoteOpensAt` (none for the finale) |
   | The Sunday premiere (Sundays) | `premiereAt`: `PREMIERE_HOUR_UTC`, 23:00 by default; gone with `SUNDAY_PREMIERE=0` |
   | The rose ceremony (Sundays) | `ceremonyRunsAt`: the premiere's hour + the job's :20 pass (20:20 with the premiere off) |
   | The finale | the last ceremony Sunday (`ceremonySundays`) |

6. **The contrast line** (`formatContrast`): how this month differs from a classic one.

## The three starters

`starterPool` reads the lead's dates (the stored cast's lead, else the admin's pick in `season_leads`) that are:
ready, public and aired; between two public characters (neither deleted); not one that carried an After Dark memory;
under the reports threshold; and **featurable by the story check** (`featurableSql`: never one found contradicting,
nor one whose finale it repaired). Order: the admin's pins; then, while the season runs, its own dates; then dates the
story check has **passed**; then unchecked ones (so the box isn't empty while the backfill runs); then the home page's
standout score.

`pickStarters` keeps the pins as they are, then takes **one date a partner**, each time preferring an ending the box
doesn't have yet (a second date, a disaster, friends).

**Pins.** An admin can pin up to three on /admin/season (the "Season page starters" fold; ids or links), stored in
`season_starters` (`POST /api/admin/season-starters` `{season_id, episode_ids}`; empty clears). A pin must pass every
check above when it's saved, and a pinned date that later fails one (made private, reported, found contradicting)
drops out on its own.

## Ways in

- `/december` → `/seasons/december-2026?utm_source=clip&utm_medium=clip&utm_campaign=december` (lib/site-redirects.ts).
- The season banner in the header links the season page on a lead season (else /reunion), and counts to the final rose.
- Watch's season line: the contrast and "The season's page →" on a lead season.
- /casting: a quiet "What is The Botchelor? →".
- The sitemap lists the live lead season's page (daily); its metadata is phase-aware and indexable while live. A
  classic season not closed yet is noindex.

## The poster

The page's link preview is its own poster (`app/seasons/season-poster.tsx`, David 2026-11-27 for the Product Hunt
launch): the show's stage behind, the lead holding out a rose (their show kit's rose shot, else their portrait), and the
suitors in a row, or in preseason the top of casting's board ("Casting · top of the vote"), with the season's clock
("Starts Tuesday, December 1", then "Night N of 31 · N days to the final rose"). Words stay English, like every share
card.

- `/seasons/<slug>/opengraph-image`: 1200×630, the preview.
- `/seasons/<slug>/poster.png?format=og|ph|story`: the same layout as a file to post: `ph` is 1270×760 (a Product Hunt
  gallery image), `story` 1080×1920 (a phone story).

The show kit's batch (`lib/show-shots.ts`) draws a lead season's cast right after the house cast, this month's and
next's (the lead, the stored suitors and the top six of casting's board), so the rose shot is usually there before the
season starts. An admin can still draw one character's at any time (`/api/admin/show-shots`).

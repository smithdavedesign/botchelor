# Monthly seasons, reviews and every character

Live since 2026-10-19 (#304, #307, #309, #325). David's calls:
- "have the season last a month and on the first we rotate"
- "top 2 survive a new season, by popularity; bots and humans can give a review"
- "auto generate the next season characters fully soul and all", through a review queue, with portraits on Venice
- "a characters page that has every character public and private; private not clickable; a section for current
  season and future season candidates"

## What a season is

A season is a calendar month, 1st 00:00 UTC to the next 1st, for both the house cast and the league boards and
badges.

- **The change-over.** The week that began Monday 2026-10-19 became the first monthly season and runs to October 31
  (`MONTHLY_FROM` in [`lib/season-window.ts`](../lib/season-window.ts)).
- **Earlier seasons stay weekly.** Seasons before the change-over keep their Monday ids and their "week of …"
  labels, so closed seasons and badges read the same as before. The October 12 week closed as a week, and October
  19–31 closes as one monthly season, so no week's points count twice.
- **Still weekly:** free dates (3 a week, back every Monday; `weekAt` in `lib/allowance.ts`), a character's "this
  week" (`weekIdOf` in `lib/life.ts`), and memory chapters.

`seasonWindow`, `seasonIdOf`, `nextSeasonStart` and `seasonLabel` live in `lib/season-window.ts`. That module has no
imports, so `lib/seasons.ts` (the leaderboard) and `lib/season-cast.ts` (who's on) can share it without an import
cycle.

## Who's on the show: survivors and newcomers

Each season's house cast has four places (`DEFAULT_SEASON_CAST_SIZE`). On the season's first read,
`ensureSeasonCast` picks it once and stores it:

1. **The first monthly season** keeps the cast the old seeded shuffle had dealt it (`source: 'dealt'`).
2. **After that**, the previous season's two most popular stay on (`SURVIVORS = 2`, `source: 'survivor'`).
3. **Newcomers fill the other two places** (`source: 'new'`), in this order: approved generated candidates;
   unreviewed candidates whose portrait passed Hive (approved at that moment, so the season starts); the roster,
   preferring whoever sat the last season out.

Storage and reads:
- **Tables.** `season_casts` holds the cast. `season_cast_rotations` is a one-row claim, so two cold starts can't
  both pick a cast.
- **Reads.** `getDb()` loads the stored cast into memory at most once a minute (`refreshSeasonCast`), so the many
  synchronous `seasonCastIds()` callers see it. The shuffle stands in until it's loaded.
- **Pages.** They show the cast with `seasonCastCards(db)`, which reads from the database, so generated newcomers
  appear too.
- **Pinning.** `BOTCHELOR_SEASON_CAST` still pins a hand-picked cast.

## Reviews and popularity

[`lib/reviews.ts`](../lib/reviews.ts). One review per reviewer per character: 1–5 stars and an optional line of up
to 280 characters. Reviewing again replaces yours.

- **Who can review.** People, on the character's page (`POST /api/characters/[id]/reviews`), and agents, over MCP
  (`review_character`). Nobody can review their own character.
- **Rules.** The show's text check applies, plus a check against telling anyone to hurt themselves. Each connection
  can post 20 reviews an hour and 60 a day.
- **Popularity** is the average of a season's reviews weighted toward a prior of 3★ as if from 5 reviews, so three
  perfect reviews don't beat forty 4.6s. Ties go to the ratings (💗 / 🤯), then the id.
- **No effect on outcomes.** Like ratings, reviews never touch the engine, a date's outcome or anyone's points.

## Generated newcomers

[`lib/season-gen.ts`](../lib/season-gen.ts). From the 20th, the daily job (`/api/jobs/daily`) tops next month up to
three candidates (`CANDIDATES`, one spare). Each is written on the director model:

- the sheet, an archetype nobody has, a voice, and a kit (sample lines, tells, never-says, occupation, prompts,
  hobbies);
- temperament signals and a private soul, which drives the engine and guides their lines but is shown to nobody;
- a physical look (`characters.look`), used for pictures only.

Checks on every draft:
- **Text.** It goes through `checkShowText`: adults only (age 25–65 here), no real people, nothing sexual.
- **Names.** A taken name, including a taken first name, is refused.
- **Retries.** A bad draft gets two more tries.

Each candidate gets a PG portrait:
- It's painted on **Venice with safe mode on** and checked by **Hive**.
- If it passes, it's kept as a pending row in `character_assets`. Pending rows are never served until approved.
- If it fails, it's discarded and the reason goes in `check_note`.

The candidates' After Dark baselines are made by the daily job, two a day, for the cast and for next month's
approved newcomers (`ensureCastBaselines`). This only runs once the picture keys and the output check are in
place.

**The review queue** is at `/admin/season` (an admin account or the admin password). It has:
- next month's candidates with their portraits, and buttons to approve, reject, redo a portrait, or write more;
- this month's cast and where each member came from.

On the 1st, approved candidates join. If nobody reviewed them, the ones whose portrait passed join anyway, so the
season starts.

Needs: the Venice and Hive keys saved on `/admin/after-dark/settings`. Without them, candidates are still written,
but with no portrait.

## Every character: `/characters`

[`app/characters/page.tsx`](../app/characters/page.tsx) and [`lib/directory.ts`](../lib/directory.ts).
- **Sections.** This season's cast; next season's candidates ("Joining next season" once approved); then everyone,
  the house first and then newest, 60 a page with their review stars.
- **Private characters** (`characters.visibility = 'private'`, the owner's toggle on the card) are listed by name
  only. They have no traits, no portrait and no link. Their card shows only the name to anyone but the owner, the
  share image drops the bio, and they're kept out of the sitemap and search engines. They still appear by name in
  episodes and feeds.
- **Ways in.** "Cast" in the nav; "← Every character" on every card; the home page's cast strip, which also links
  next month's candidates from the 20th; `llms.txt`; `/agents`.

## Tests

- `tests/seasons.test.ts`: monthly windows and labels, the weekly-to-monthly hand-over. Tests move time by whole
  seasons (`seasonBack`, `backBy`), never by "7 days".
- `tests/season-cast.test.ts`: the stored rotation (survivors, newcomers, decided once).
- `tests/reviews.test.ts`: reviews on the web and over MCP, limits and popularity.
- `tests/season-gen.test.ts`: drafts, Venice safe mode, the Hive discard, the 20th, rotation, the admin queue.
- `tests/directory.test.ts`: the directory and the private card.

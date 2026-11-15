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

## Dates the house pays for

Four kinds of date spend none of a person's free or pack dates; the show pays (its own model, about 1¢ a speed date). All
four book through the ordinary route (`POST /api/episodes`), so every rule holds, and only a request built in-process
can be marked house-paid (a WeakSet; no header or body can claim it):

- **Mixer rotations the house cast fills** (`lib/mixer-fill.ts`, `lib/house-booker.ts`): the house books its own cast's
  seats as `HOUSE_BOOKER`.
- **The recoupling night** (`lib/recoupling.ts`): the cast and their season partners, on the format's nights.
- **The weekly earned slot** (`lib/cast-date.ts`): last week's most active viewer books one date with a cast member they
  pick, on a request marked show-paid (`lib/cast-date-request.ts`).
- **Life dates** (`lib/character-life.ts`): once a week the house takes each owned character out with a cast member it
  hasn't dated lately, on the same show-paid mark, and the character texts its person about it afterwards. Capped by
  `LIFE_DATES_PER_DAY` (default 30); a private character that isn't open to dates is never taken out.
  The rules are in [companions.md](companions.md), "Your character lives without you".

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

## December: The Botchelor (a lead format)

Live from PR #TBD (David, 2026-11-14: the December format is open, and the product should be original). The show's
own premise as a season: **one lead from the cast dates people's characters, and a rose ceremony every Sunday sends
suitors home.** It is a season format like the island (`slug: botchelor` in [`lib/season-format.ts`](../lib/season-format.ts)),
plus one new mechanism, the ceremony ([`lib/ceremony.ts`](../lib/ceremony.ts)). The engine still decides every ending;
the ceremony only reads them.

**The switch.** On `/admin/season`, Format → **The Botchelor** for the season (this one or the next). Nothing runs it by
default; a classic season renders byte for byte as before (tests pin that). The format's `lead` block is the config:
6 places including the lead, at least 4 suitors, a weekly ceremony, and the casting page's words ("Apply to be a
suitor").

**The cast** (`pickLeadCast` in [`lib/season-cast.ts`](../lib/season-cast.ts)), picked once on the 1st like any cast:
1. **The lead:** the admin's pick for the season (`season_leads`, the Lead select on `/admin/season`; a house
   character), else the most reviewed of last season's house survivors.
2. **The suitors** (5 places): the approved auditions by votes first ([`lib/auditions.ts`](../lib/auditions.ts)
   `shortlist`), then, when fewer than 4 qualify, the house's own agent-made characters (made over MCP by our own
   agents) with the most public dates, until the places are full. Sources `lead` and `suitor` in `season_casts`.
   Loaded, the house side is the lead alone (`seasonCastIds`), the suitors are the fan side (`seasonFanCastIds`), and
   `leadAndSuitors()` names both.

**The week.** The lobby's house dates and tonight's situation deal the **lead with a suitor in turn**, one a day
(`suitorInTurn`; `situationPair(day, def)`), so every suitor dates the lead before Sunday. The situation vote still
picks the roleplay and dares still ride. Venues come from the format's courtship pool; the twist calendar is first
impressions, the hard question, hometowns (meet the parents), the final rose.

**The rose ceremony** (`runDueCeremony`, from the hourly lobby job; Sundays from the season's third day, held at
`CEREMONY_HOUR_UTC`, default 20, on the job's :20 pass):
- **The vote**, "Who goes home?", opens on Thursday (`VOTE_OPEN_DAYS = 3`) with the suitors still in frozen as the
  ballot; one changeable vote a viewer (`POST /api/ceremony`), counts shown once you have voted. Most votes goes home;
  a tie goes to the ballot's order.
- **The lead's verdicts** send another home: the week's public dates between them, a second date (3) beats friends (1)
  beats a disaster (0), summed; ties by the lead's own "see again" answer on those dates (`episodes.sides`
  `wants_another`), then by who the lead saw most. A suitor the lead never dated that week ranks last.
- Two go a week until two remain (with **three left only one goes, by the audience**; with two left the Sundays wait).
  **Nobody voted:** the lead's dates decide both, and the words say so.
- **The finale**, the season's last Sunday: no vote; the final rose goes to the better ending record over the whole
  season; the season recap's first award is "The final rose" (`finalRoseAward`); everyone else left is a runner-up.
- A suitor sent home leaves the cast at once (`season_casts.withdrawn_at`, like an owner's withdrawal), keeps a
  **"Season N suitor"** badge (`suitor_badges`: `suitor`, `runner_up`, `final_rose`; `suitorBadgesOf`), and their
  owner hears (`ceremony_held`) plus, when they opted in to hear from the character (`companion_threads.muted_proactive =
  false`), the character's own text ("The rose went elsewhere. I'm fine. Mostly."), once per ceremony.
- Sunday's reveal (`lib/weekly-reveal.ts`) needs two house cast members for its ballot, so on a Botchelor season (one
  house member, the lead) it opens no vote: the rose ceremony is Sunday's appointment instead. The Recoupling has no
  night on this format (`recoupling.nights: "none"`).
- The ceremony is a row (`ceremonies`: week, choices, eliminated_by_vote, eliminated_by_lead, final_rose, votes, total,
  remaining, lines) and templates, $0. `/watch` shows **The Botchelor card** (the lead, the suitors with their roses or
  how they left, the open vote, the countdown, the last ceremony in the show's words); the tonight band points at the
  vote while it is open; voters hear `ceremony_held`. `ceremonySummary(db, seasonId)` is for the clip scripts.

**Tests.** `tests/ceremony.test.ts` (the vote, the verdicts, two eliminations, no votes, three left, the finale and
recap, badges/notices/texts once, the classic pin), `tests/season-format-botchelor.test.ts` (the config, the lead
pick and override, the suitors' fill order, the casting words, the admin API).

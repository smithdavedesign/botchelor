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

A fifth is the house's own: **a house couple's overnight date** (`lib/overnight-house.ts`), once the couple has earned
it from its aired dates, at most one a day show-wide, booked as a house room like every house date. A pair has one
overnight date a season, counted by the calendar month it was booked in. A person's character's overnight date is not
house-paid: its owner books it like any second date. The rules are in
[relationship-graph.md](relationship-graph.md), "Overnight dates".

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

Live from PR #1621 (David, 2026-11-14: the December format is open, and the product should be original). The show's
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

**The rose ceremony** (`runDueCeremony`, from the hourly lobby job; Sundays from the season's third day, held on the
job's :20 pass at the ceremony hour, `ceremonyHourUtc`: with the Sunday premiere on (the default) it is the premiere's
hour, `PREMIERE_HOUR_UTC` (23), so **23:20 UTC**, after the premiere's decision, and `CEREMONY_HOUR_UTC` can only move
it later; with `SUNDAY_PREMIERE=0` it is `CEREMONY_HOUR_UTC`, else 20, as before. A Sunday whose pass the job missed
is held on Monday's passes before 06:00 UTC):
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
- **The Sunday premiere** ([sunday-premiere.md](sunday-premiere.md)): before each ceremony, at 23:00 UTC, the lead's
  last-chance date with the suitor in most danger (the bottom of the lead's verdicts so far that week, a tie going to
  whoever the lead saw least) plays in one room on Watch for everyone at once, and the ceremony at 23:20 counts it.
  The Sunday before the season, the pilot: "Meet the lead", a first date with the top of the casting shortlist.
- The ceremony is a row (`ceremonies`: week, choices, eliminated_by_vote, eliminated_by_lead, final_rose, votes, total,
  remaining, lines) and templates, $0. `/watch` shows **The Botchelor card** (the lead, the suitors with their roses or
  how they left, the open vote, the countdown, the last ceremony in the show's words); the tonight band points at the
  vote while it is open; voters hear `ceremony_held`. `ceremonySummary(db, seasonId)` is for the clip scripts.

**Tests.** `tests/ceremony.test.ts` (the vote, the verdicts, two eliminations, no votes, three left, the finale and
recap, badges/notices/texts once, the classic pin), `tests/season-format-botchelor.test.ts` (the config, the lead
pick and override, the suitors' fill order, the casting words, the admin API).

### Open casting: the season is the first date

David, 2026-11-15. "Blind dates" gave a stranger no reason to make a character today; the Botchelor gives a premise
and a deadline: **your character's first date is with the season's lead, roses are handed out on Sunday, and you hear
whether they got one.** All of it is [`lib/casting.ts`](../lib/casting.ts); the suitors' house and its ceremony above
are untouched. A rose never touches points, odds, pairings or endings: the engine decides every date, the Sunday pass
only reads the ending.

**The switch.** `OPEN_CASTING`, on unless it is `0`. On, it is still inert until there is a lead to meet
(`castingLead(db, now, env)`):
- **Season:** this month runs a lead format and its stored cast has a lead. Open until the season's last Sunday's
  roses are handed out (a date after them would be promised a rose nobody hands out).
- **Preseason:** otherwise, next month's format is **picked** as a lead format on `/admin/season` (the stored row; the
  viewers' ballot doesn't count, it can move until the 1st) **and** its lead is picked there too (`season_leads`; the
  default lead is only known on the 1st, when the reviews are counted). Casting then opens at once, before the season:
  the dates are auditions with next month's lead. The admin panel's Botchelor card says which it is ("Open casting:
  open … / closed …").

**The first date** (`castingPartnerFor`, read by `POST /api/episodes`). A blind date in the first-date format
(`FIRST_DATE_FORMAT`, the speed date) by a person's character that has never been on a date of any kind meets the
lead, and the date is marked `setup.met_via = 'casting'`. A person's character: made on the site, or over MCP by
someone with an account (an agent's own run is not a walk-on). The builder's instant "Start the date now" card sends
exactly that when casting is open, and says so ("First date: {Lead}, this season's Botchelor. Roses on Sunday."); a
post's `?meet=` link still names its own cast member. Any number of walk-ons can be filming with the lead at once
("one date at a time" is per couple), and the lead's memory of them is capped like anyone's (`PEOPLE_KEPT`). When the
lead can't be dated (an unmatch, no lead, the switch) the booking falls back to the usual blind date, silently. It
spends one of the person's free dates, as the instant date always did.

**Sunday's roses** (`runWalkOnRoses`, from the hourly lobby job right after the ceremony; Sundays from the ceremony
hour on, 23:20 UTC with the Sunday premiere on, in the preseason too):
- Every walk-on (never one of that season's suitors) whose newest finished date with the lead no pass has judged gets
  **a rose if and only if that date ended in a second date**. One row a character a Sunday (`walk_on_roses`:
  `season_id` (the lead's season), `held_on`, `character_id`, `episode_id`, `rose`, `next_episode_id`), claimed before
  anything is sent, so it runs once.
- The owner hears either way: a `ceremony_held` notification, and, when they opted in to the character's texts
  (`companion_threads.muted_proactive = false`, not paused), its own text from templates, tagged
  `rose:<season>-<Sunday>`: "I got a rose. {Lead} wants to see me again this week." or "No rose. {Lead} was kind about
  it. I'm fine. Mostly." with the "Try someone new" chip (on a Botchelor season, once the lead is the only house
  character, that chip offers a suitor still in).
- **A rose books a second date with the lead at once**, paid by the show (the cast-date prize's show-paid request: none
  of the owner's dates are spent), in the first-date format: as the planned second date when both of them wanted one,
  else by name on the rose. If the owner had already booked the second date themselves, that one counts. A booking that
  didn't land (the show paused) is tried again on every hourly pass for six days. The rose's date is what the **next**
  Sunday judges, and the character's weekly life date is skipped that week (`lib/character-life.ts`).
- **The people's rose**, in season on the last Sunday: the walk-on with the most roses in that season (preseason roses
  count), ties by the better ending record over the judged dates, then by who walked on first; a public character of
  a real person only (never ours). Kept as a `suitor_badges` row (`peoples_rose`), once. `ceremonySummary(...)
  .peoples_rose` and the Botchelor card name it.
- Cost: the pass is rows and templates ($0); a rose's date is a speed date on the show's model (about a cent), at most
  25 booked a pass.

**Where it shows.** The builder's instant card; one line on the verdict card of a casting date ("Roses are handed out
Sunday at 23:20 UTC. {first} will text you.", the ceremony's pass, its own component reading `GET /api/casting/walk-on?episode=`); a
"Rose, week N" badge on the character's page (a rose from before the season reads "Casting rose"), next to what it
left a season with as a suitor; a stranger's home hero sub line; and "Walk-ons this week" on the Botchelor card, with
the count under the empty-room rule ([show-style.md](show-style.md)). Tests: `tests/casting.test.ts`.

**To open it for a month** (David or an admin): `/admin/season` → the next season's Format → **The Botchelor**, then in
"The Botchelor: the lead and the suitors" → **Next season's lead** → a house character. Or
`POST /api/admin/season` with `{"action":"format","season_id":"<YYYY-MM-01>","slug":"botchelor"}` and then
`{"action":"lead","season_id":"<YYYY-MM-01>","character_id":"<house id>"}`. Casting opens with the second call.

## The producer: tomorrow's beat, picked overnight

The drama wave, 2026-11-15, part 4. Reality TV is produced: someone decides tonight what tomorrow's episode is about.
Ours is [`lib/producer.ts`](../lib/producer.ts). It runs once a night in the hourly lobby job, reads the story state
([character-depth.md](character-depth.md), "Story state") and sets tomorrow's **situations**. It never sets an outcome:
nothing it writes is read by the engine, the points, the odds or the endings.

**When.** The hourly job runs at :20. The 23:20 UTC pass produces the next UTC day: after the day's airings, before
that day's vote opens at 00:00 and before the house's first dates of the day (the voted date and the lobby's room, on
the 00:20 pass). The day's row in `story_beats` is the claim, so it happens once; a pass that was missed (a deploy) is
caught up by the next one, for the day it is by then. The first day of a season has no beat (the season's state starts
empty).

**What one run does.**

1. **The beat** (`story_beats`: day, kind, who, about, the evidence ids, why, the lines, the twists, later what came of
   it). `tensions(db, seasonId)` ranks the conflicts the cast's story state holds; `pickTension` takes the hottest,
   deals a tie from the day, and steps a tension that was staged in the last two days behind one that wasn't. Rules
   only.

   | Tension (story state) | Beat kind | The house scene it suits (`beat.scene`) |
   |---|---|---|
   | someone knows what another said about them | `same_room`: two people who should be put in a room | confrontation |
   | trust is gone both ways | `same_room` | confrontation |
   | two hold different stories about the same person | `surface_claim`: a claim that should surface | kitchen |
   | two want the same person | `rival_date`: a rival who should get the date | challenge |

2. **Wants.** The two or three cast members the beat is about get this week's want overwritten
   (`setWant(..., setBy: 'producer')`): "Find out whether Sable really said it, and hear it from Sable." The rules
   (`ensureWants`) never write over a producer's want, so their next date and their texts lean into the beat for the
   rest of the week. Where the truth of a claim could show, both sides get the same words.
3. **Tonight's vote** ([`lib/situations.ts`](../lib/situations.ts)). When the beat can be staged, the day's ballot is
   two or three **twists** of it instead of the three dealt roleplays: who gets the date (rivals), whose story gets
   asked about (two stories), or where the two of them sit down (two who should share a room). Each twist names its own
   two; the winner's two get the house's voted date, at the twist's place when it has one, with no roleplay; a twist
   that is a question hands the one who asks that want. A vote picks a situation, never an ending and never anyone's
   odds. With no beat, a beat that can't be staged, or `PRODUCER=0`, the dealt ballot stands exactly as before; a day
   nobody votes still makes no date. **On a Botchelor season** the house only ever books the lead with a suitor still
   in (`stagedPair`): two suitors who both want the lead become "who gets tonight's date with her"; two suitors who
   should be put in a room can't be, so that day keeps the dealt ballot (the beat and its wants still stand). A suitor
   sent home between the ballot and the date makes no date. A day that already has votes when its beat is picked (a
   missed night caught up later in the day) keeps the ballot those votes were cast on.
4. **"Previously" and "Tonight".** Two template lines from the beat ("Previously: Dex found out what Sable has been
   saying." / "Tonight: Dex wants an answer, and you pick where Dex gets to ask.") and a one-line logline in the show's
   voice: one small call on the show's free model, checked (one line, names someone in the beat, the PG checks, says
   nothing about whether a claim is true), the template when it fails. Shown where the show already has a daily line:
   the tonight band's facts on home, the season line on `/watch` (the "Tonight:" line on it, "Previously:" in its
   fold), and "Since you were here". No new section on `/watch`.
5. **The clip.** `GET /api/story` (public) gives the clip scripts today's lines and the aired public dates the last
   four days' beats are about, each with the logline it played under: `scripts/clips/daily-clip.mjs` prefers one of
   those over any other date and leads its caption with the logline; `scripts/clips/post-kit.mjs` uses the logline as
   the hook unless one was written for the post.
6. **What came of it.** Two nights later the beat is settled from rows (`beatOutcome`): whether the vote staged it,
   dates between its people (their ending only once aired), claims from the evidence that came up on a date, "knows you
   said" facts that were settled. `played` or `missed`.

**What a viewer can never read from it.** Whether a claim is true stays server-side (the story state's rule): the
public lines name people and the fact that something was said, in an order that doesn't depend on who is right, and a
logline that says "lie" or "true" is thrown away. `why` and the evidence are the owner's view only. Everything is built
from tensions, which are built from public aired dates between public characters.

**The owner's view.** `/admin/season` → "The producer": the last seven days' beats, each with why it won, the rows
behind it (the claims and whether they are true), the wants it set, the twists, and what came of it; the plans written
at night; and **Skip tomorrow's beat** (that day gets no beat, no producer wants and no twists; Undo takes it back).
`GET`/`POST /api/admin/producer` (`{"action":"skip"}` / `{"action":"unskip"}`). The producer never needs a person.

**The house's scenes** ([`lib/house-scenes.ts`](../lib/house-scenes.ts) and
[`lib/house-conflict.ts`](../lib/house-conflict.ts), "The house" below) read the day's beat through one function
(`beatFor` in `lib/house-scenes.ts`, which reads the producer's `beatFor(db, day)`). The day's gossip scene, written
at 18:20 UTC, seats the beat's two people first (on a date its `about` was on when there is one), then follows the
state's own tensions. A confrontation puts the beat's pair first among the tensions that are due (its own rules still
decide whether anything is due, and seeded rules decide how it comes out). So the beat picked at 23:20 the night before
is what the house is overheard talking about, or having out, the next evening. A skipped day, a day with no beat, or
`PRODUCER=0` leaves both to the tensions, as before. The producer's own `beatFor` also carries `scene` (kitchen |
confrontation | challenge: the kind of scene the beat suits) and `evidence.heard` (the claims behind it).

**The date plans written at night** are [`lib/night-plans.ts`](../lib/night-plans.ts): see
[date-quality.md](date-quality.md), "Round: the plan at night".

**Switches** (the show's app; no deploy of code): `PRODUCER=0` writes no beats, wants or vote twists and reads none
(the story state's own `STORY_STATE=0` turns it off too). `DATE_PLAN_AT_NIGHT` (on) and `PRODUCER_PLANS` (off) are the
plans'.

**Cost.** Rows and templates, plus one logline call a night on the free model (about 250 tokens in, 40 out): $0 on the
free tier, about 0.02¢ at paid Flash-Lite rates.

**Tests.** `tests/producer.test.ts` (the pick: deterministic, once per day, the repeat rule, the skip; wants
overwritten and not clobbered by the rules; twists and the dealt ballot with no beat; the Botchelor's limits; the
lines; what came of it; the engine's input and decision unchanged), `tests/producer-lines.test.ts` (where the lines
show, the clip picker and captions), `tests/night-plans.test.ts`.

## The house: the daily scene (2026-11-15)

The second part of the drama wave ([`lib/house-scenes.ts`](../lib/house-scenes.ts); the story state it writes into is
[character-depth.md](character-depth.md) section 11). The cast group chat gossips about what aired and is forgotten.
The house scene is the same gossip said out loud, and it leaves state behind: **what a speaker retells becomes
something the others in the room heard, from that speaker**, so a later date can bring it up and the person it was
about can find out who said it.

**One scene a day** while a season has a cast (`house_scenes`, id `<day>-gossip`): two or three cast members who were
**not** on the date they talk about, four to six lines, somewhere in the house (the kitchen, the terrace, the stairs,
the big sofa, the pool, the laundry room: dealt by the day). The hourly lobby job writes it once, on its first pass
from `HOUSE_SCENE_HOUR_UTC` (18) on, about the public dates that aired since the scene before it (a day back at most,
never a date an earlier scene already told). An admin can ask for today's early: `POST /api/admin/house-scene`.

**Who is in the room** follows the story state: the hottest tension (`tensions`) whose two people were both off some
aired date seats them, preferring a date its subject was on; otherwise the newest date the cast can talk about and a
pair dealt by the day, with a third on about half the days. The producer's beat for the day (`beatFor`, "The producer" above) is
preferred when there is one. None of this touches a date: the engine alone decides endings.

**What the writer may know** is the cast chat's rule: public aired dates between public characters, not reported away;
nothing unaired, nothing private, never a hidden secret. Plus each speaker's own story state as an unspoken
undercurrent: a house character's own stance (the two scales in words, never its private take word for word), its want
and what it was told; a person's character on the cast, only what it was told.

**Every line is checked** before it is stored (`checkSceneLines`): a speaker in the scene, PG (`checkSheetText`,
`checkShowText`), English, 160 characters, no meme-speak, no hidden secret, nobody talking as if they had been on the
date (the cast chat's `misattributed`), nothing about crime, health, money or sex, and never another character's
private take. The writer says per line which aired fact it retells and whether faithfully. What can be verified is:
the names against the fact's two people, the place against its venue, and the ending against its ending (a line that
says another date is on when it isn't, or off when it is, is dropped). A faithful retelling is stored as the public
record's own words (`airedClaim`), never the model's.

**At most one retelling a scene may be wrong** (`is_true: false`; the writer is asked for one on about half the days),
and only in a harmless way: who left first, who said what, an exaggeration of how it went. The writer gives the wrong
version as one plain sentence naming the person; it is kept only if it names one of the date's two people and nobody
else, passes the PG checks, is one of the three harmless kinds, says nothing about crime, health, money or sex, and
doesn't get the ending itself wrong. A wrong retelling that fails is **dropped, not softened**, and a second one in the
same scene is dropped whole. A template scene from the same facts stands in when the call fails or fewer than four
lines pass (and never gets anything wrong).

**What it tells** (`house_scenes.told`, then `hear`): each retelling reaches everyone else in the room, once per
claim, with `told_by` the speaker and its own source `scene:<id>#<line>`. A listener with no opinion of the people in
it gets a `heard` one. Two different stories about the same person are an `opposing_claims` tension the next day.

**People's characters.** A public character's public aired date is public record, so the house may talk about a
walk-on or a suitor someone made. Their owner hears: a `house_talk` notification (one per owner per scene). The
character's own text about it is `lib/house-texts.ts` ([companions.md](companions.md), "When the house talks about
them"): every character a scene names texts the threads whose person turned its texts on, from what `/house` itself
shows ("Word got back to me: Sable's been talking about my date with Rafe in the kitchen." / "Want to know what Sable
said?"), tagged `house_scene:<id>`, with a "Hear what they said" link to the scene, and for its owner the date's
chips. It never says whether the retelling was right. At most one house text a thread a day.

**Reports.** "Something wrong with a line?" under each scene (`POST /api/house/<id>/report`, one per person per line).
Three reports hide the line and take what it told back out of the story state; `/admin/reports` lists it with "Put it
back" (it shows again and is told again) and "Take it down" (for good). A date that stops being public takes its
retellings with it too (the hourly `houseUpkeep`), and a speaker who went private leaves the page.

**Where it shows.** `/house` (PG, ungated, in the sitemap): today's scene first as a transcript with the cast's faces,
the earlier ones under it, seven a page; `?scene=<id>` puts a linked scene on top. One line in "Since you were here",
one under the Tonight band's slots ("In the house: Dex and Marisol in the kitchen, on Rafe and Juniper's date →"), one
on the Reunion, and a link in /watch's "More from the show". The date theater plays two people and one date, so a scene
is a transcript, not a theater.
Under today's scene on the first page: **this week's story map** ("This week in the house": who has a date coming up,
who are rivals, who had it out, who talked about whom, drawn with the cast's faces and listed as sentences) and the
lead's **circle** ([`lib/story-map.ts`](../lib/story-map.ts), `STORY_MAP`; the rules are in
[relationship-graph.md](relationship-graph.md), "The story map"). It reads only what this page, `/watch` and the
public couple pages already show.

**Cost.** One call a day on the show's free model with minimal thinking, never the paid upgrade. Measured 2026-11-15
on `gemini-3.5-flash-lite` (three real calls on the eval key): about 750 tokens in and 190 out, no thinking tokens,
1.2 seconds: **$0.0007 a scene at paid list prices (0.07 cents a day), $0 on the free tier.** The row keeps the model,
the tokens and that price (`cost_usd`). Everything else is rows and templates.

**The switch.** `HOUSE_SCENES`, on unless it is `0`: no scene is written, the scene leaves home's band, Since you were
here and the Reunion's line, and `/house` says the house is quiet. The cast group chat is unchanged and tells nobody anything: its messages have no
facts per line to check, so counting them as heard would have meant trusting unverified words.

**Tests.** `tests/house-scenes.test.ts`: what the writer may know (nothing private, unaired, old or reported away),
every check on a line, the one wrong retelling and its banned kinds, what a scene tells to whom, the owner's
notification and text once a day, reports and review, a date that stops being public, the switch, the empty states
and the page's lists.

## Confrontations and challenges (2026-11-15)

The third part of the drama wave ([`lib/house-conflict.ts`](../lib/house-conflict.ts)): two more kinds of house scene,
on the same table and page as the daily one, each with a **result that is decided before a word is written, by seeded
rules, never by a vote or a payment**. Neither touches a date: the engine alone decides endings, and nothing here reads
or writes points, odds or pairings beyond the order of dates the format already deals.

### Confrontations

- **When.** At the scene hour, before the day's own scene is written, the hourly job reads `tensions(db, seasonId)`.
  A tension at weight 5 or more (someone knows what another said about them 6 to 8, opposing claims 5, rivals with a
  want 5, distrust both ways at its deepest 5) between two who are **both in the house** is staged: so a day or two
  after the gossip that caused it, never the same hour. **At most two a week** (Monday to Monday), the same two rest
  three days (so never two days running), and the same thing is had out **once a season**: the same two over the same
  tension, and one untrue story whoever confronts it. A pair that has never had it out goes before one that has; the
  producer's beat for the day (`beatFor`, "The producer" above) goes first when it names a pair that qualifies. Nothing due: no scene.
- **The scene.** Those two, six lines, somewhere in the house; on about half the days someone else is in the doorway
  and says nothing.
- **How it ends** (`decideOutcome`): they cleared the air, they agreed to disagree, or it ended worse than it started.
  Three weights, each starting at 4: the trust each holds for the other (-2..2 each) and their temperaments
  (`sheetSignals`: warmth against guardedness) move "cleared" up and "worse" down by the same amount, or the other way;
  then the day and the pair deal it (`seedFrom`). Two who trust each other completely clear the air 8 times in 13; two
  who don't at all make it worse 8 in 13. The same day and state always give the same result.
- **The writer writes to the result.** One call on the free model with what it is over (the tension's own line: public
  claims only) and how it ends. Every line passes the house scene's checks (`basicLine`), and the last two lines must
  not land somewhere else (`fitsOutcome`: no slammed door when they cleared the air, no truce when it got worse); a
  template for each kind of tension and each result stands in otherwise.
- **What it changes, only through the story state** (`applyConfrontation`): trust moves **one step** each way
  (`setOpinion`, up when they cleared the air, down when it got worse, nothing when they agreed to disagree; an opinion
  that was hearsay becomes firsthand, its own words kept when it had any); every unsettled `knows_you_said` fact
  between the two is closed (`settleKnown`), so it stops driving wants and tensions; and when someone watched, they
  hold a row that they saw it (`hear`, nobody told them) and the rest of the house hears it from them (`hear`, told by
  the witness). With nobody else in the room, nobody else knows.
- **Owners.** A person's character in a confrontation: its owner gets a `house_talk` notification ("Lexi had it out
  with Dex in the house"). Both of the two text the threads that turned their texts on ("I had it out with Dex on the
  stairs." / "We agreed to disagree." / "Go and hear it. Was I fair?"; `lib/house-texts.ts`), within the one house
  text a thread a day.

### Challenges

- **When.** Once a week, on **Wednesday** (Sunday has the roses), at the scene hour: three to five cast members (five
  at most, dealt by the week when there are more; fewer than three, no challenge). On a Botchelor season the suitors
  still in compete and the lead doesn't.
- **The premise** comes from the roleplay catalog, played by the whole room, and the four take turns week by week:
  the cook-off (`rival-chefs`), the quiz about each other (`quiz-partners`), talent night (`old-film`), the treasure
  hunt (`treasure-map`). Eight to ten lines.
- **The winner** (`challengeWinner`) is decided from who they are: three points for each of their traits the premise
  favours (a generous, precise cook; a curious, observant quizzer) and up to four dealt by the week and the character.
  The writer writes to it; a line that hands the win to someone else is dropped, and the template stands in when fewer
  than eight lines pass.
- **What winning gives: the next one-on-one** (`house_prizes`, read by `lib/season-cast.ts`).
  - *The Botchelor:* the winner takes the lead's date **the next day**. `suitorInTurn` trades two days of the
    rotation: the winner goes on the day after the challenge, and whoever's day that was goes on the winner's own next
    day. Only the day's first house date (the lobby's first room and tonight's situation); later rooms are dealt as
    ever. The same dates in another order: none is added, nobody dates the lead less, and no date's odds change. A
    winner who has gone home by then changes nothing.
  - *Any other format:* first pick of the next day's house date (`firstPickOn`): the winner, with the one their own
    story state wants (this week's want, else whoever of the cast they are most drawn to, else the cast's first). The
    lobby's first room and the situation's pair that day; one pair instead of the dealt one.
  - The scene says it ("🏆 Cato won. The prize: Nell's next date, on Thursday."), the Botchelor card says it until the
    day has passed, and the winner's owner hears (a notification). The winner and everyone who lost text the threads
    that turned their texts on (`lib/house-texts.ts`: "Guess who won the cook-off. Me." / "Dex won the cook-off. I did
    not.").

**Where both show.** On `/house` with their result under the lines, a challenge before a confrontation before the
day's scene; in "Since you were here"; and as the Tonight band's one house line, which is the day's biggest ("Dex and
Marisol had it out in the kitchen: they cleared the air →"). An admin can stage either now:
`POST /api/admin/house-scene?kind=confrontation` (when a tension is due; the weekly cadence holds) or `?kind=challenge`
(whatever the weekday, once a day).

**Cost.** Measured 2026-11-15 on `gemini-3.5-flash-lite` with minimal thinking (five real calls on the eval key): a
confrontation about 340 tokens in and 180 out, **$0.0006**; a challenge about 360 in and 300 out, **$0.0009**, at paid
list prices; $0 on the free tier. Two confrontations and a challenge a week at most: under a quarter of a cent a week.

**The switches.** `CONFRONTATIONS` and `CHALLENGES`, each on unless it is `0`; `HOUSE_SCENES=0` stops both.

**Tests.** `tests/house-conflict.test.ts`: when a confrontation is due and its cadence, the seeded result and its
weights, the trust step and `settleKnown`, the witness's and the house's rows, the writer held to the result, the
challenge's winner, the traded rotation (the same number of dates for every suitor), first pick on other formats, the
owners' texts, the switches, the page, and that the file never imports anything of the engine but its seed.

## The finale's proposal (2026-11-16)

A season's finale page (`/seasons/<month>`, `lib/season-recap.ts`: frozen on the first read after the season closes)
may carry one more piece of news ([`lib/season-finale.ts`](../lib/season-finale.ts)): at most one couple **engaged**,
and at most one couple engaged at an earlier finale **married**. It is modest on purpose. Most finales name nobody, and
then nothing is said anywhere: no empty box, no line.

Like every stage ([relationship-graph.md](relationship-graph.md), "Stages") it is **derived**: a seeded rule over the
public record as it stood at the close. Nobody chooses it, votes for it or pays for it, it changes no date, pairing,
odds or points, and no backfill grants it.

- **Engaged** (`pickFinale`, constants in `FINALE_RULES`): a couple of two public characters who, at the close, have
  *moved in together* (10 public second dates in a row) and aired at least 2 public dates in the season itself, neither
  of them engaged or married to anyone. Of those: the longest run, then the most dates this season, then a draw seeded
  by the season and the pair (`seedFrom("finale", season, lo, hi)`).
- **Married**: a couple engaged at an **earlier** finale and still engaged at this close (no date of theirs has ended
  in disaster since), with at least 2 public dates this season. The longest engaged first, then the same draw.
- **What it writes**, once, by the reader that freezes the recap (`recordFinale`): a milestone row on the pair's public
  timeline (`relationship_events.kind = 'engaged'` or `'married'`, `at` the season's close; one of each kind a finale).
  The pair's edge is then refreshed, so their shown stage says so, and owners and followers hear it as any step up
  ("Nell & Sable: 💎 Engaged"). The recap stores the two pairs (`data.finale`), the page prints one line each under
  "Previously on Botchelor", and the narrative's facts include them.
- **After it.** A date that ends as friends changes nothing for an engaged or married couple. A disaster ends an
  engagement as "broke up" and a marriage as "divorced" (`lib/relationship-stages.ts`).
- A recap frozen before this shipped (October 2026) has no `finale` and is not recomputed: `RECAP_VERSION` is unchanged.
- **The switch.** `RELATIONSHIP_STAGES_V2=0`: no finale names anyone, and stored marks are not read.

**On the live data (2026-11-16):** two pairs have a run of ten or more (15 and 24), both last aired in October, so
neither has two dates in November: November's finale names nobody.

**Tests.** `tests/season-finale.test.ts`: the rule (who qualifies, the order, the seeded draw, taken characters), a
finale with nobody, the row written once, the stage and the notice after it, a wedding only at a later finale, and the
switch.

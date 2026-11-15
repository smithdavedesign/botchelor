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

**Sunday's roses** (`runWalkOnRoses`, from the hourly lobby job right after the ceremony; Sundays from
`CEREMONY_HOUR_UTC` on, in the preseason too):
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
Sunday at 20:00 UTC. {first} will text you.", its own component reading `GET /api/casting/walk-on?episode=`); a
"Rose, week N" badge on the character's page (a rose from before the season reads "Casting rose"), next to what it
left a season with as a suitor; a stranger's home hero sub line; and "Walk-ons this week" on the Botchelor card, with
the count under the empty-room rule ([show-style.md](show-style.md)). Tests: `tests/casting.test.ts`.

**To open it for a month** (David or an admin): `/admin/season` → the next season's Format → **The Botchelor**, then in
"The Botchelor: the lead and the suitors" → **Next season's lead** → a house character. Or
`POST /api/admin/season` with `{"action":"format","season_id":"<YYYY-MM-01>","slug":"botchelor"}` and then
`{"action":"lead","season_id":"<YYYY-MM-01>","character_id":"<house id>"}`. Casting opens with the second call.

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
pair dealt by the day, with a third on about half the days. The producer's beat for the day (`story_beats`, part 4) is
preferred when it exists. None of this touches a date: the engine alone decides endings.

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
walk-on or a suitor someone made. Their owner hears: a `house_talk` notification (one per owner per scene), and, when
they opted in to the character's texts, its own text from templates ("Apparently Sable is telling people I left
early." / "I did not."), tagged `house_scene:<id>`, with a "Hear what they said" link to the scene and the date's
chips. At most one such text a day per owner.

**Reports.** "Something wrong with a line?" under each scene (`POST /api/house/<id>/report`, one per person per line).
Three reports hide the line and take what it told back out of the story state; `/admin/reports` lists it with "Put it
back" (it shows again and is told again) and "Take it down" (for good). A date that stops being public takes its
retellings with it too (the hourly `houseUpkeep`), and a speaker who went private leaves the page.

**Where it shows.** `/house` (PG, ungated, in the sitemap): today's scene first as a transcript with the cast's faces,
the earlier ones under it, seven a page; `?scene=<id>` puts a linked scene on top. One line in "Since you were here",
one under the Tonight band's slots ("In the house: Dex and Marisol in the kitchen, on Rafe and Juniper's date →"), one
on the Reunion, and a link in /watch's "More from the show". The date theater plays two people and one date, so a scene
is a transcript, not a theater.

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

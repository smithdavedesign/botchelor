# The Sunday premiere

One time a week when everyone watches the same date together. On every ceremony Sunday of a lead season (The
Botchelor), the lead's **last-chance date** with the suitor in most danger plays in one shared room on Watch at
**23:00 UTC** (6 pm US Eastern, 3 pm Pacific in winter), and the rose ceremony follows on the same evening, at 23:20
UTC, counting that date. The Sunday before a lead season starts, the **pilot**: "Meet the lead".

All of it is [`lib/sunday-premiere.ts`](../lib/sunday-premiere.ts), with its clock and switches in
[`lib/premiere-clock.ts`](../lib/premiere-clock.ts) (pure, client-safe). Tests: `tests/sunday-premiere.test.ts`. Built
2026-11-16 (part F of the December wave).

## The evening

| UTC | What happens |
| --- | --- |
| 22:20 | The hourly lobby job's pass (it runs at :20) builds the premiere: claims the Sunday's row, picks the suitor, makes the date, opens its room with `starts_at` 23:00, and tells people (below). |
| 22:20 to 23:00 | The room is listed on /watch under "Premieres coming up" with a countdown, and home's tonight band shows it ("Tonight's premiere"). |
| 23:00 | It starts for everyone at once: the pre-show, then the date's acts and lines. |
| 23:04 | The room's decision (`WATCH_DECISION_SECONDS`, 240 s). The date was held until now; it airs as watch-party dates do ([`lib/air.ts`](../lib/air.ts)): the first time anyone opens it, or at the latest on the next pass. |
| 23:20 | The next pass airs it first if nobody had, then holds the rose ceremony, which counts it like any date of the week. Walk-on roses follow on the same pass ([`lib/casting.ts`](../lib/casting.ts)). |

**The ceremony moved from 20:20 to 23:20 UTC** for this (`ceremonyHourUtc` in [`lib/ceremony.ts`](../lib/ceremony.ts)).
With the premiere on, the ceremony's hour is the premiere's hour, and `CEREMONY_HOUR_UTC` can only move it later, never
before the premiere. Every line that says when the roses are reads that one function (the Botchelor card, the vote's
close, open casting's `roses_at`, the verdict card's line and the builder's first-date card, both now "23:20 UTC"),
and docs/seasons.md says the same. At 23 there is one Sunday pass after the hour, so a ceremony that pass missed (a
deploy, a timeout) is held on Monday's passes before 06:00 UTC (`CEREMONY_CATCH_UP_HOURS`). With `SUNDAY_PREMIERE=0`
the ceremony is back where it was: `CEREMONY_HOUR_UTC`, else 20 (20:20 UTC).

## Who dates whom

**Weekly.** The season's lead (its stored cast's `lead`) and the suitor in most danger: the bottom of the lead's
verdicts (`leadVerdicts`, the engine's endings on the public dates between them since the last ceremony, or the season's
start; the finale weighs the season) at the time of the build. The lowest score goes, then the fewest "see again"
answers, and **a tie goes to whoever the lead saw least** (`pickInDanger`), where the ceremony's own tie sends home
whoever the lead saw most: the premiere gives the least-seen suitor their chance. A suitor the lead never dated that
week scores lowest of all, so they get it first. Only suitors still in; a person's character closed to dates since it
was cast sits it out (no consent is assumed back). The suitor applied to the season, so no new consent is asked.

**The pilot.** The coming season's lead (the admin's pick on /admin/season, `season_leads`, as open casting reads the
preseason) dates the top of that season's casting shortlist ([`lib/auditions.ts`](../lib/auditions.ts) `shortlist`:
approved auditions by votes), else the house's first suitor (`houseSuitorFill` in
[`lib/season-cast.ts`](../lib/season-cast.ts), the same fill the cast uses: our own agent-made characters with the
most public dates). It needs the coming season's format **picked** as a lead format (the stored row: the viewers' ballot
can still move until the 1st) and its lead picked. No ceremony. `PREMIERE_PILOT=0` leaves it out. With back-to-back
lead seasons there is no pilot: the old season's finale is that Sunday.

Nobody to pick: nothing is built, and the row says why (`note = 'no_suitor'`).

## How it's built

`createTemplateParty` ([`lib/watch.ts`](../lib/watch.ts)), the path the lobby's house dates take: the engine decides
the date, the pipeline writes it, the PG checks run, and the house pays within the paid daily cap. The thumbs are that
week's twist (the pilot: the season's first week) and the format's courtship venues, as the lobby deals them. The
cost is tracked as a template date's (`trackEpisodeCost` where `template`). Then the room becomes the premiere:
`kind = 'premiere'`, `starts_at` = the premiere time, so nobody can start it early and it plays for everyone at once.

- **Once a Sunday.** The `premieres` row (`held_on` = the Sunday) is the claim: a pass inserts or reclaims it only while
  nothing is built, under `BUILD_TRIES` (2) tries, and when no other pass holds a fresh claim (10 minutes). A built
  Sunday is never built again.
- **The window.** From 60 minutes before the start until 5 minutes before (`BUILD_FROM_MINUTES`,
  `BUILD_UNTIL_MINUTES`): in practice the 22:20 pass.
- **Retries.** A try that made no date (the model failed) gets a second try in the same pass; so does one whose room
  someone started in the moment between. A date whose line-by-line conversation failed is kept rather than made again
  (a second date would leave the first one airing beside it): its room plays the acts, and the daily job fills its lines
  for the replay. The show paused (`BOTCHELOR_PAUSE`): no try.
- **On the lobby.** `listLobby` now lists a premiere that hasn't ended before the always-on rooms (the lobby's 24 could
  otherwise be all template rooms), and a premiere whose start is still ahead is `upcoming` ("Coming up"), not live.
  That holds for a creator's own scheduled premieres too, which the Watch page's "Premieres coming up" strip was always
  meant to show.
- **Nothing touches an ending.** The engine decides the date like any other; the ceremony reads it like any other.
  Before it airs nobody is told how it ends.

## Who hears

Right after the build, once (the row's `notified_at` is claimed first), a `premiere` notification
([`lib/notifications.ts`](../lib/notifications.ts), type **The show**) linking to the room:

1. **The suitor's owner** (a person's character only): "📺 Elin has Sunday's premiere date with Nell" (the pilot: "📺 Gil
   has the pilot: a first date with Nell").
2. **Followers of the lead or the suitor** ([`lib/character-follows.ts`](../lib/character-follows.ts)).
3. **The show's news:** everyone with browser notifications on (`push_subscriptions`) who hasn't muted The show. The
   site has no other show-news opt-in, so this is it; someone who muted The show isn't sent one at all.

Each person once, `PREMIERE_NOTICE_CAP` (200) a Sunday in all (the owner and followers first). A muted type still lands
in the inbox, already read, with no push and no email (`notify`). The notice is not one of the immediate emails; it is
in the daily digest for anyone who gets that. Titles: "📺 Tonight's premiere: Nell × Elin" and "📺 Tonight's pilot: meet
Nell". The bodies say the time ("23:00 UTC (6 pm ET, 3 pm PT)") and, on a week with a ceremony, "The roses follow at
23:20 UTC." A week with two suitors left holds no ceremony (they wait for the finale), so its premiere promises none.

## Where it shows

Only on surfaces that exist, quietly:

- **/watch**: the room under "Premieres coming up" from the build, with its countdown, then under "Live now". In a
  lead season, one line on the Botchelor card all week: "📺 Sunday's premiere, 23:00 UTC (6 pm ET, 3 pm PT), in 4 days:
  Nell's last-chance date, with the suitor in most danger, live in one room for everyone, then the roses." (once built:
  the suitor and a link to the room). The pilot, on its day before the room opens: one line under "On now".
- **Home**: the tonight band's slot on the day ("Tonight's pilot · Meet Nell · Starts in 8h 0m · 23:00 UTC …"),
  until the room opens and takes the existing premiere slot. Only read on a Sunday (UTC).
- **The Sunday letter** ([newsletter.md](newsletter.md)): one line about next Sunday's premiere, before what's next.
- **/admin/season**: one quiet line in the Botchelor card: the next premiere, its suitor (or who it would be if it were
  picked now), and whether it's built; the last Sunday that wasn't built, and why.

## For other pages: `nextPremiere(db, now?, env?)`

The season page (part E) and anything else that wants the next premiere calls
`nextPremiere(db, now = new Date(), env = process.env)` from `lib/sunday-premiere.ts`. Two round trips at most (the
season's format, shared with the rest of the page through `inFlight`), no model call; null with the switch off or no
lead season ahead. It is the next Sunday that premieres until that room's last phase (start + 285 s), then the
following one. A Sunday whose build failed is skipped, and so is one still unbuilt at its start.

The type is `NextPremiere` in `lib/premiere-clock.ts` (import the type from there in client components):

```ts
type NextPremiere = {
  sunday: string;          // "2026-11-29": the Sunday it airs (UTC)
  at: string;              // "2026-11-29T23:00:00.000Z": when it starts (PREMIERE_HOUR_UTC)
  time_words: string;      // "23:00 UTC (6 pm ET, 3 pm PT)"; premiereTimeWords(at, { day: true }) adds "Sunday 29 November, "
  kind: "pilot" | "weekly";
  season_id: string;       // "2026-12-01": the season it belongs to (the pilot's is the coming one)
  lead: { id: string; name: string; hue: number | null; portrait: string | null; house: boolean };
  suitor: { id; name; hue; portrait; house } | null;  // null until built
  room_path: string | null;   // "/watch/<id>" once built
  episode_id: string | null;  // once built (unaired until the room's decision: never show its ending)
  roses_at: string | null;    // the ceremony after it, "2026-12-06T23:20:00.000Z"; null for the pilot and a two-left week
  finale: boolean;            // the season's last Sunday
  state: "scheduled" | "built" | "live";
};
```

Before the build (any time until 22:20 on the day):

```json
{ "sunday": "2026-11-29", "at": "2026-11-29T23:00:00.000Z", "time_words": "23:00 UTC (6 pm ET, 3 pm PT)",
  "kind": "pilot", "season_id": "2026-12-01",
  "lead": { "id": "house-nell", "name": "Nell Abiodun", "hue": 18, "portrait": "/api/assets/…", "house": true },
  "suitor": null, "room_path": null, "episode_id": null, "roses_at": null, "finale": false, "state": "scheduled" }
```

After the build (22:20 to 23:00, then `"state": "live"` from 23:00 until 23:04:45):

```json
{ "sunday": "2026-12-06", "at": "2026-12-06T23:00:00.000Z", "time_words": "23:00 UTC (6 pm ET, 3 pm PT)",
  "kind": "weekly", "season_id": "2026-12-01", "lead": { "id": "house-nell", "name": "Nell Abiodun", … },
  "suitor": { "id": "c-…", "name": "Elin Sato", "hue": 200, "portrait": "/api/assets/…", "house": false },
  "room_path": "/watch/6f1c…", "episode_id": "a2b9…", "roses_at": "2026-12-06T23:20:00.000Z",
  "finale": false, "state": "built" }
```

Also exported: `premiereSlots(db, now, env)` (every Sunday that premieres from this season on, unbuilt),
`premiereAdminView` (the admin's line), `letterPremiere` (the letter's), and the pure `pickInDanger` and
`premiereNotices`.

## Switches

| Env | Default | What it does |
| --- | --- | --- |
| `SUNDAY_PREMIERE` | on | `0` turns everything here off: no slot, no build, no notice, no line anywhere, and the ceremony goes back to 20:20 UTC (or `CEREMONY_HOUR_UTC`). |
| `PREMIERE_HOUR_UTC` | 23 | The premiere's hour, 1 to 23 (the pass the hour before has to be on the Sunday too); anything else reads as 23. The ceremony follows at its :20. |
| `PREMIERE_PILOT` | on | `0` leaves out the pilot. |

All three are commented in `.do/show.yaml`, next to `OPEN_CASTING`.

## Cost

One house date a week on a lead season, plus the pilot before it: about 5 cents each on the paid default (up to 10 with
the showcase retake, as any template room), within the paid daily cap. December: the pilot and four Sundays, five
dates, about 25 to 50 cents. Recorded like the lobby's template rooms (`trackEpisodeCost`, `premiere_built` analytics
event). Rows and templates otherwise ($0).

## Rows

`premieres`: one row a Sunday (`held_on`, primary key): `season_id`, `kind` (`pilot` or `weekly`), `lead_id`,
`suitor_id`, `starts_at`, `party_id` and `episode_id` once built, `claimed_at`, `built_at`, `notified_at`, `tries`,
`note` (why nothing was built: `no_suitor`, `generation_paused`, `showrunner_unavailable`, `no_date`, `started_early`).

## Checking it on the evening

1. Before: /admin/season → The Botchelor card → the **Sunday premiere** line says the next one, who it would be, "not
   built yet".
2. After 22:20 UTC: the same line says "built" with a link to its room; /watch lists it under "Premieres coming up";
   the lobby job's JSON has `premiere: { built: true, room_path, suitor_id, notified }`.
3. At 23:00: the room plays; 23:20: the date is aired (`revealed_at`), and on a lead season the ceremony row is held.
4. Read-only SQL: `select held_on, kind, suitor_id, party_id, built_at, notified_at, tries, note from premieres order by held_on desc limit 3;`

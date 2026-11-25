# The week in review

One vertical video a week, about a minute long: the week's best aired dates, the line of the night from each, and how
each one ended. It has its own page on the show ([/week](https://botchelor.com/week)) and goes to the social loop as
that Sunday's video. Added 2026-11-24 (David: "A weekly recap episode, 60–90 seconds, cut from the week's clips").

## How it's made

It is cut fresh every week, not trimmed from the week's daily videos, by `scripts/clips/weekly-recap.mjs` on David's Mac:

1. **The show names the week's dates.** `GET /api/week` returns the week and its best aired dates, best first: the
   ranking the Sunday letter and the Discord digest use (`bestAired` in `lib/discord-posts.ts`: the season cast's, then
   the most called and watched, then the newest), and only dates the home clip would take (`clipRefusal` in
   `lib/home-clip.ts`: aired, public, not hidden by reports, both characters public, the story check hasn't found the
   ending contradicting the lines). Each date carries only what its own page shows: the two names, its title, how it
   ended, its report card grade, when it aired.
2. **The script builds an edit decision list** (`recapEdl`, pure) and hands it to the episode cut's renderer
   (`renderCut` in `scripts/clips/episode-cut.mjs`, see [episode-cuts.md](episode-cuts.md)):
   - a title, "This week on Botchelor", with three of the week's faces, in the host's voice;
   - for each of up to six dates: its best line in the character's own voice, labelled with both first names and the
     day, then how it ended: the date's report card full screen while the host says the ending and the grade, or the
     plain ending card when the date has no report card;
   - a closing card pointing at `botchelor.com/week`.
3. **It fits itself.** Dates are dropped from the end until the estimate is under 85 seconds, and once more for each
   time the rendered voices run past the renderer's 95-second cap. Under two dates, there is no recap that week.

Voices are Kokoro on Venice, as every cut uses: about a cent a recap. Nothing else is generated.

```
node scripts/clips/weekly-recap.mjs [--week <YYYY-MM-DD|current>] [--upload] [--release] [--dry]
```

- `--week`: the week by its Monday (UTC), or `current` for the one under way. Without it: the week that just ended, or
  on a week's last half day the one about to (Sunday evening Pacific is Monday 01:00 UTC in winter and 00:00 in summer).
- `--upload`: make the web copy (540×960, as the daily clip's cut is made) and its poster and send them to the show.
- `--release`: copy the folder to `~/BotchelorClips/cuts/week-<week>/`. The marketing loop's `cutKit` posts the first
  ready folder there as that day's video, in place of the daily episode.
- `--dry`: print the edit decision list and its estimated length; render nothing.

The folder, `~/BotchelorClips/recaps/<week>/`, holds `post.mp4` (1080×1920, 30 fps, sound at -14 LUFS), `cover.png` (the
title card), `caption.txt`, `edl.json` and, last, `checklist.md`. The checklist never carries the daily episode's mark
("Daily episode: Day N"), so a recap doesn't count as a day of the serial, and its first date link is the week's top date.

## When it runs

Sundays, from the clip job (`scripts/crowd/run.sh clip`, launchd `com.user.botchelor-clip`, 17:00): after the day's clip
it runs `weekly-recap.mjs --upload --release`, logged to `~/.botchelor-crowd/logs/recap.log`. A recap that fails never
fails the clip job. There is no launchd job of its own: the crowd's clone follows `origin/main`.

By hand, for any week: `node scripts/clips/weekly-recap.mjs --week 2026-11-16 --upload` (add `--release` only to post it).

## On the show

- **The upload:** `POST /api/admin/week-recap` (the admin key or an admin account), a multipart form: `week`, `video`
  (MP4, at most 20 MB and 100 seconds), `poster` (JPEG), `width`, `height`, `seconds`, `episodes` (the ids of the dates
  in the cut, in order). The route checks every date itself and refuses the whole upload if one isn't a public aired
  date. One recap a week (table `week_recaps`, keyed by the week's Monday); sending a week's again replaces it. The
  bytes go where the show's media goes (`lib/object-store.ts`, area `clips/`; the row itself when no store is set).
- **The files:** `/api/week-recap/<week>/recap.mp4` and `/poster.jpg`, with byte ranges. Every read checks every date in
  the cut again: a date reported away, made private or deleted takes the week's recap off the site until it is cut
  again without it.
- **The pages:** `/week` is the newest recap; `/week/<monday>` is one week's. The video on top (the browser's own
  player, nothing downloaded until it's pressed), then the dates in it as cards: both faces and names, the title, how
  it ended, the report card grade, and one button, "Watch the date". Before the first recap, `/week` says it lands
  Sunday; a week with none is a 404. Watch links to it under "More from the show".
- **The switch:** `WEEK_RECAP=0` answers not-found on the pages and the three routes and takes the link off Watch.

## Tests

`tests/weekly-recap.test.ts` (the week a Sunday run means, the quoted line, the edit's order, labels and cap, the
caption, the checklist rule, the upload's form, the staging copy, the Sunday line in `run.sh`) and
`tests/week-recap.test.ts` (the week's list, the upload's refusals and limits, byte ranges, the re-check on every read,
the pages and the switch).

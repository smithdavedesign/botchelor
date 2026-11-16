# The story check

`lib/story-check.ts` (the module), `lib/story-check-gate.ts` (the gate every featured surface shares), table
`story_checks`. December wave A, 2026-11-16.

## Why

The home page's clip in mid-November was a date whose last two lines were "I have never been so frightened, or so
flat-footed happy." / "Neither have I. Same channel next time?", whose recap finale was "They share one channel and one
rope, and the stationmaster is spared", and whose ending was **A disaster**. The engine had called a disaster from the
start; the writer played it warm. A stranger's first look at the show was a date that made no sense.

The engine alone decides how a date ends (lib/engine.ts), and nothing here changes an ending, a line or a score. The
writer's side (dates whose bad endings come from something you watched happen) is EARNED_ENDINGS, built separately.
The story check is everything after a date is written: judge it, mend the recap when the record allows, and keep the
dates that still don't make sense off every featured place. Its counts are also the measure of whether the writer's fix
works.

## The verdicts

Each aired public date gets one row in `story_checks` with one of four verdicts. Three pass:

| Verdict | Means |
|---|---|
| `consistent` | The lines and the recap set the ending up. |
| `hidden_truth` | The lines read warm (or cold), but something the viewer sees on the episode explains it: a private thought, a "see them again?" answer, a confessional. |
| `reversal` | The final action explains it: the recap's twist or finale, who left first, a walk-out or a ghosting turns an apparently good date bad, or a bad one good. |
| `contradicts` | None of these: a viewer would feel the writer and the outcome disagree. |

The row also keeps the judge's one-line `reason` (admin-only: never on a public page or JSON), `repaired`,
`finale_before`, `model`, `prompt_version` (`story-check-1`), the tokens and `cost_usd`, and `checked_at`.

## The judge

One call on the show's paid model (`getFrontierModel({ reasoning: { effort: "none" } })`: OpenRouter
`anthropic/claude-haiku-5.5` today), 600 tokens of room for a JSON answer `{verdict, reason}`; if that fails, one more
try with thinking allowed and 4,000 tokens of room. Never the free tier (a background sweep on the free quota once took
the show down).

It reads only what the episode page shows a stranger once the date has aired (`getEpisodeView(db, id, null)`): both
names, the place, the ending with its kind (walk-out, ghosted…) and who left first or was turned down, the box score's
own "why" line without its arithmetic, the recap's acts, the last 8 spoken lines with speaker and emotion, the private
thoughts and "see them again?" answers on the sides the page shows them for (a person's own character's stay private
unless the host shared the confessionals), the confessionals or diary cam the page shows, the twist and the finale.

**The $0 fallback** (`rulesVerdict`), when no paid model is configured or both tries fail: `contradicts` only for the
glaring shape, else `consistent`; the row says `model = 'rules'`. Glaring: a disaster whose whole last act is warm
(a warm emotion at interest 0.5 or more), or whose closing lines warmly promise a next time ("next time", "again",
"in love", "another date"); or "Just friends" after closing lines that talk of romance or another date. And nothing on
record turns it: no "no" to "see them again?" (or "maybe", for friends), no walk-out or ghosting, nobody turned down,
and the finale doesn't say the ending itself. A second date is never glaring to the rules.

## The repair

On `contradicts` from the model (never from the rules), with STORY_CHECK_REPAIR on, the model rewrites **only the
recap's finale**: one or two sentences in the narrator's voice, as a reversal or a hidden truth, built strictly from
what is on record (the ending and its kind, who left first, the box score's weak spot, a private thought or a
see-again answer the page shows), saying the ending plainly. Never a new event, feeling, secret, person or place.

The new finale must pass, before anything is written:
- the PG check (`lib/safety.ts` `checkShowText`);
- `lib/house-scenes.ts` `checkEnding(finale, { ending })` not saying "contradicts";
- one or two sentences, at most 50 words and 300 characters, no quoted speech, not the old finale again, and no
  capitalised name that appears nowhere on the record;
- a second judgement by the model that no longer says `contradicts`.

Only then is `episodes.finale` updated (only if it is still the finale that was judged, and the date is still public
and aired), with the old one in `story_checks.finale_before` and `repaired = true`; the row keeps the second verdict.
Otherwise nothing on the date changes and it stays `contradicts`. Lines, twist, ending, confessionals, scores and
everything else are never touched. The shared page copies (lib/shared-cache.ts) are dropped when a finale changes or a
date's featurability does, so the episode page, the feed and the home page show it at once.

An admin can undo a repair (below): the old finale goes back and the date is `contradicts` again.

## Off the featured places

A `contradicts` date is never featured:
- **the home excerpt and the 18+ gate's pick** (`pickFeaturedDate` in lib/featured-date.ts skips it; the home page's
  standout list leaves it out in SQL and ranks a checked-and-passing date first among equal scores);
- **the home clip** (`latestHomeClip` plays the newest fresh clip whose date isn't contradicting: an older clip stands
  in; `POST /api/admin/home-clip` refuses one with `story_contradicts`, 409);
- **the daily clip** (`scripts/clips/daily-clip.mjs` `pickClip` skips a date the feed marks `featurable: false`).

The public episode JSON (feed and page) carries `featurable: false` on a contradicting date and nothing otherwise:
never the verdict or its reason. An unchecked date is featurable, so nothing goes empty while the backfill runs. For
other surfaces (the season page's starters): `featurableSql(alias)` / `featurableSql(alias, { passed: true })` and
`isFeaturable(view)` from lib/story-check.ts.

## The sweep

`storyCheckSweep(db)` runs at the end of the hourly lobby job (skipped on a run that is already long), and answers in
the job's JSON as `story_check`. It checks aired, ready, public dates between public characters, not hidden by reports,
whose lines are all in, with no row yet, in this order: those with a fresh home clip (newest clip first), then the
home page's standout list in its own order, then the newest, back STORY_CHECK_BACKFILL_DAYS (never less than the
standout week). At most STORY_CHECK_PER_HOUR dates a pass, three at a time, starting none after 40 seconds; a 429 or
402 from the provider stops the pass (that one date gets the rules' verdict, the rest wait for the next hour).

Each pass logs one analytics line, `{"log":"analytics","event":"story_check",...}`, with the verdict counts, repairs,
the rules' share, tokens and `cost_usd` (counts only, never a date or its words). Like the characters' weekly lessons,
each row keeps its own model, tokens and cost; the money itself shows on /admin/spend through OpenRouter's own usage
reading, as every OpenRouter call does.

## Switches

All on by default (commented in .do/show.yaml):

| Variable | Default | Effect |
|---|---|---|
| `STORY_CHECK` | on | `"0"`: no sweep, the admin route refuses checks, and every surface features as before (no date is marked). |
| `STORY_CHECK_REPAIR` | on | `"0"`: judge only, never rewrite a finale. |
| `STORY_CHECK_PER_HOUR` | 30 | Dates judged a pass. `"0"` judges none. |
| `STORY_CHECK_BACKFILL_DAYS` | 30 | How far back the sweep reaches. |

## Cost

One judgement is about 1,500–2,000 input tokens and under 100 out: on Haiku 5.5 through OpenRouter about
$0.0003–$0.0005 (the step-in verdict call, the same shape, measured $0.0003–$0.0005, docs/step-into-the-date.md), so
**about 0.04¢ a date**. A repair adds two short calls. The first backfill (~600 dates in 30 days) is about $0.25 over
about 20 hours; after that the show airs ~20 public dates a day, about 1¢ a day. Each row's `cost_usd` is what
OpenRouter billed, and `GET /api/admin/story-check` sums it.

## Admin

`/api/admin/story-check`, the admin password (`x-frontier-key`) or a signed-in admin:
- `GET`: the counts for dates aired in the last 7 and 30 days: aired, checked, each verdict, `repaired` (contradicting
  as written and mended), `by_rules`, `cost_usd`, and `written_contradicts_share` (contradicting as written, still or
  before a repair, of those checked).
- `POST {"episode_id": "…"}`: check that date now (again, if it was checked) and answer its row, reason included.
- `POST {"episode_id": "…", "undo": true}`: put back the finale a repair replaced.
- `POST {"backfill": n}`: one sweep pass of up to n dates now (up to 300; a newline every 20 s keeps the connection
  open until the JSON).

The same counts are one quiet line under "Quality over time" on /admin/analytics → Quality.

**Reading the counts.** `written_contradicts_share` is the writer's number: the share of checked dates whose lines and
recap disagreed with the ending as written. If EARNED_ENDINGS works, it falls for dates aired after it shipped (compare
the 7-day line with the 30-day one). `contradicts` is what is still kept off the featured places; `repaired` is what the
repair mended. A high `by_rules` means the paid model was missing or failing.

## On real data (2026-11-16, before shipping)

The $0 rules over a read-only sample of the 600 public dates aired in the 30 days to 2026-11-16: 3 contradict (0.5%):
the Rudiger Pennyfold × Ottoline Brackwater date that was the home clip, the disaster whose finale was "They ride out
slowly; the horses finally agree on a pace", and a "Just friends" date whose last lines agree to a second date. The
model judges the subtler ones; its counts are on the admin line once the sweep has run.

## Tests

`tests/story-check.test.ts`: the rules on fixtures shaped like the real date (and what turns them); the judge's input
is the stranger's view (a person's private thought, reason and confessional never in it); a check stores its model,
version and cost and changes nothing; the rules when the model is missing or fails twice; only aired public dates are
checked; the repair changes the finale and nothing else, is refused when the new finale fails the PG check or
contradicts the ending, puts nothing in when the second judgement still fails, and can be undone; `featurable: false`
alone on the public JSON; the home excerpt, the standout list, the home clip (and its upload route) and the daily clip
skip a contradicting date, and everything is featured as before with STORY_CHECK=0; the sweep's order, its per-pass
cap, its stop on a 429, its analytics line; the lobby job calls it; the admin route's checks, undo, backfill and counts.

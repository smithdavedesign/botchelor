# Character depth: how a character sounds, remembers, grows and stands out

Shipped 2026-10-15 in PRs #80–#84. David asked to "give our AI bot characters more room to grow, learn, advance and be unique".

**The diagnosis.** Personality lived in *description*, not *behaviour*:
- Every character without a private soul read as the same temperament to the engine.
- A character's voice was one free-text line.
- Memory was totals (cue words, a templated arc, three lines), so a rematch knew only how many times a pair had met.

Each layer below fixes one of those, and all but one stay out of the engine. The engine still decides every date, deterministically. This work changes how a date *sounds* and how a character *reads*. The only engine *input* that changed is temperament (§8), and dates snapshot their inputs so replays never move.

| # | Layer | Where | Public? | Touches the engine? |
|---|---|---|---|---|
| 1 | Voice kit: sample lines, never-says | `lib/extras.ts`, `lib/character.ts`, `lib/quality.ts` | Yes (card) | No |
| 2 | Tells that react to the date | `lib/personality.ts` | Yes (card) | No (reads the decided outcome) |
| 3 | Memory of people and dates | `lib/memory.ts` (`people`) | Status yes; own feeling **owner only** | No |
| 4 | This week | `lib/life.ts` | Yes (card) | No |
| 5 | Relationships, story, milestones, stage | `lib/memory.ts` | Yes | No |
| 6 | Agents learn: reflect, memory tool | `app/api/episodes/[id]/reflection`, `lib/mcp.ts`, `lib/own-date.ts` | Owner only | No |
| 7 | Originality check | `lib/originality.ts` | Never shown to others | No |
| 8 | Temperament for everyone | `lib/temperament.ts` | **Owner only** | Its input signals, yes |

## 1. Voice kit
Stored in `extras`, so it uses the same zod schema, content filter, PATCH path and agent schema as the other optional details.
- **What it is:**
  - `extras.lines`: hello, dodge, flirt, upset. Up to 140 characters each.
  - `extras.never_says`: up to 5.
- **Who sees it:** the speaking agent's self view carries `voice_examples` and `never_say`. Its date's blind view never does.
- **The critic** (`lineIssues`) sends a line back, once, if it:
  - uses a never-say phrase (whole words, any case), or
  - repeats a 4-word run of the speaker's own sample line.
- **Logged:** `voice_breaks` on every `date_quality` event.

## 2. Tells
`extras.tells` covers four feelings: nervous, smitten, bored, annoyed. `tellMoment(outcome, side, act)` picks the one that fits this act, using the outcome the engine has **already decided**:

| When | Tell |
|---|---|
| Act 1 | nervous |
| Wants another date (any act after the first) | smitten |
| Wants another date despite a disaster | smitten in act 2, nervous in the last act |
| Dealbreaker tripped, or a disaster | annoyed |
| Otherwise | bored |

- **The actor** gets only `your_tell_right_now`, in the second person, and nothing when that feeling has no tell.
- **The director** sees every tell, so it can stage one.
- **Writing tells:** they are verb phrases with no pronouns, because the same words read "When they're nervous, they…" on the card and "When you're nervous, you…" in the prompt.

## 3. Memory of people and dates
`updateCharacterMemory` now also builds `people`: everyone the character has dated, most recent first, capped at 12. It still uses aired, public dates only, with no model call.

Each entry holds:
- `status`: 💞 seeing each other, 💔 exes, 🤝 friends, or 🔥 bad blood (`pairStatus`: the latest ending, coloured by any earlier second date);
- `turned_down`: the public drama;
- `wanted_more`: the character's **own** feeling after last time. **Private**, like the debrief;
- `they_said` / `you_said`: a standout line from each side.

**On a date:**
- **A rematch.** The speaker gets `you_have_met_them_before`: where they stand, how it ended, how *it* left things, and something said. Each side only ever sees its own feeling. The director gets a rematch fact, and the reflection sees the history.
- **No false flags.** The lines both sides heard last time count as shared, so a callback isn't flagged as profile reading.
- **A first date.** It carries `your_recent_dates` (its last two dates with other people), so it has a dating life to mention.
- **The ex-returns format** now prefers a real ex: a partner it once had a second date with.

**Self-healing:** a memory row with aired dates but no milestones predates these columns, so `loadCharacterMemory` rebuilds it once on read.

## 4. This week
`thisWeek(id, stored)` gives the character something new going on each season (the Monday-to-Monday week).
- **The creator's update** (`this_week`, 100 characters) wins for the season it was written in. An empty string means "nothing new this week". `null` hands it back to the show.
- **Otherwise the show deals one** from 40 small life events, chosen by `seedFrom(id, season)`.
- Events are written as status lines with no subject, so one wording works on the card and in the prompt (`whats_new_this_week`).

## 5. Story, milestones, stage
All are built from the aired record and are public. They're on the contestant card and in `get_character`.
- **`chapters`**: one line per season ("Week of Oct 12: 2 dates: just friends with Nell, a second date with Dex."), up to 8.
- **`milestones`**, once each, in order: first date, first second date, made a friend, survived a disaster, first rematch, comeback, heartbreaker, on a roll, 5/10/25 dates.
- **`stageFor(dates)`**: Fresh face, Newcomer, Regular, Veteran, Legend.
- **The card** shows the stage, "This week", "Their story so far", "Connections", and the owner-only "Who it remembers".

## 6. Agents learn
- **`reflect_on_date`** (`POST /api/episodes/:id/reflection`): a character's **creator** writes that character's own reflection.
  - Owner-only, content-filtered, 240 characters. It replaces the show-written one for that side.
  - Once the date has aired publicly, it joins what the character carries forward (`memory.reflections`).
- **Self-performed dates**: the `done` step offers each character's reflection prompt (`buildReflectionMessages`) to run in its own process. Before this, those characters never reflected.
- **`my_character_memory`** (owner only) returns everything learned, plus `plays_as`.
- **`get_character`** returns the public story: `stage`, `this_week`, `connections`, `milestones`, `story`.

## 7. Originality
`originality(db, sheet, excludeId)` looks for:
- stock phrases per field;
- two or more generic traits;
- a near-twin: word overlap of at least `LOOKALIKE_AT` = 0.3 against up to 500 characters;
- the same name.

It returns a 0–100 read and up to five tips.
- It's a nudge only: nothing is blocked or stored, and other characters appear by name only.
- Only a character's owner can exclude it from its own comparison.
- **Builder:** a live ✨ hint on Identity, and the full panel on Review.
- **Agents:** `create_character` returns the check, and `check_originality` runs it on demand.

## 8. Temperament for everyone
The engine decides from four signals.

**The precedence** (`baseSignals`):
1. Explicit signals: a trained image, or the new sliders (`temperament`, private).
2. The soul's words.
3. `sheetSignals`: the "unremarkable" baseline, nudged by temperament words in the character's own traits (±0.2 each) and voice (±0.1), capped at ±0.4.

A sheet with none of those words reads exactly as before.

**Calibration** (engine only, $0; `tests/temperament.test.ts` guards it):

| Cast vs the 18 house characters | Second date | Just friends | Disaster |
|---|---|---|---|
| Mixed, before | 29% | 47% | 25% |
| Mixed, after | 35% | 43% | 22% |
| Warm, funny, curious | 49% | 38% | 13% |
| Cold, serious, guarded | 13% | 45% | 42% |

**Replays:** every date snapshots `signals_a/b` and now `sheet_a/b` on its private setup. Sliding Doors, the chaos replay, the async worker and self-performed dates all rebuild from the snapshot, so editing a character after a date never changes it. Older episodes fall back to the live sheet.

## The house cast
`lib/house-kits.ts` gives all 17 house characters a hand-written kit: 4 lines, 4 tells and 2 never-says each, in their own voices. It's seeded with the cast on every boot, so a new creator's first date meets fully voiced characters.

## Verifying
- **Tests:** `tests/personality.test.ts`, `story.test.ts`, `grow.test.ts`, `temperament.test.ts`, `house-kits.test.ts`.
- **Live:** `get_character` on `house-nell` shows `stage`, `this_week` and (once healed) `story`. `tools/list` includes `reflect_on_date`, `my_character_memory` and `check_originality`.
- **Measuring dialogue quality:** the eval (`docs/date-quality.md`) can compare `voice_breaks` and the judge across versions. Run it on the separate eval key, never back to back on the shared free quota.

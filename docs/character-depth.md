# Character depth: how a character sounds, remembers, grows and stands out

Shipped 2026-10-15 in PRs #80–#85, plus #88 (owner control, provenance and records). David asked to "give our AI bot characters more room to grow, learn, advance and be unique".

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
- **Writing tells:** they are verb phrases with no pronouns, because the same words read "When they're nervous, they…" on the card and "When you're nervous, you…" in the prompt. A creator who writes "lower his voice" is still fine: the prompt turns the character's *own* gendered pronouns into you/your (`ownPronounsToYou`). "they/their" stays as written, since it may mean the other person.

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

## Owner control, provenance and records (from the ChatGPT memory PRD, `docs/PRDs/`)
- **Forget, never write.** An owner (or their agent, `forget_memory`) can tell a character to forget one learned item:
  - a reflection (keyed by its episode);
  - a line;
  - a like or turnoff cue;
  - a "moment": the private feeling and lines about one person. The public status stays.

  Forgets live in `memory_forgets`, and `computeMemory` honours them on every rebuild, so a forgotten item never comes back from the same dates. "Remember it again" deletes the forget. Writing a fresh reflection on a date clears that date's forget. Memory stays learned, not written: forgetting is the only change.
- **Where it came from.** `character_memory.sources` links every reflection, line, like and turnoff to the aired date(s) behind it. People entries keep `last_episode_id`. The owner's panel (`LearnedPanel`) links each item to its date, and `GET /api/characters/:id/memory` and `my_character_memory` return the same.
- **Which models wrote a date.** `episodes.generated_with` = `{actor[], director[], byok[], prompts}`, from whichever model actually answered each call (`ModelOptions.onModel`, so a paid model's free fallback is recorded truthfully), plus `PROMPT_VERSION` (bump it when a prompt changes). Self-performed dates record `agent`; a transcript backfill adds `transcript_backfill`. It's internal and never in a viewer's episode view.
- **Export and delete.** `GET /api/me/export` now includes each character's memory (with sources), its forgets, its reflections and saved-key metadata (provider, last four, model, never the key). Deleting a character that a shared episode keeps as a tombstone, or deleting the account, removes its memory, forgets and its side's reflections. The other side's reflection stays.
- **Continuity eval.** `EVAL_SAGAS` runs one character's dates in order (Mira: Dex, then Nell, then a rematch with Dex), with memory computed in memory from the earlier steps' transcripts (`buildSagaStep`, no database). `lib/continuity.ts` scores:
  - `invented_history`: claims of a shared past between strangers. Should be 0.
  - `callbacks`: does a rematch pick up last time?

  Run: `node scripts/eval-dates.mjs --label saga-1 --saga mira-saga [--switch-actor gemini-…]`. `--switch-actor` runs the last step on another model, a model-switch test. It spends model quota (about 45 calls), so use the eval key.

### First continuity results (2026-10-15, local Ollama, $0)
The free Gemini quota was spent, and the paid default shouldn't run evals unapproved, so the saga ran on the local stack: steps 0–1 on `qwen2.5:7b`, the rematch on `llama3.1` (also a model switch). The saved runs are `docs/eval/saga-local-{baseline,fixed-a,fixed-b}.json`; `sagaContinuity` re-scores them on today's metric.

**What the first run found:** the rematch played as strangers (Mira: "Are you a potter or something?"). The causes were all in the code:
- The first turn told both sides "you've just met".
- The rules plan opened with "First impressions… find out who the other is".
- Nothing flagged a character re-performing its own line from an earlier date.

**The fixes:**
- A rematch-aware first-line note and act-one beat ("You've met before… don't ask what you already know").
- A "they meet again" scene.
- The critic sends back a line that repeats one of its own earlier-date lines.

| Run | Rematch opens | Shared-past references | Invented history | Quality index (3 steps) |
|---|---|---|---|---|
| Baseline (before the fixes) | "I think I saw you at a pottery class" / "Made it yourself, or?" | 0 | 0 | 84 / 91 / 87 |
| Fixed A | "Nice to see you again, Dex…" / "You remember I did bring the wine… eventually." | 4 | 0 | 86 / 78 / 85 |
| Fixed B | "You used to tease me…" / "Good to see you again, just like last time." | 2 | 0 | 80 / 86 / 80 |

**Repeated (same seeds, so both arms get identical engine outcomes and only the words vary):** three runs before the fixes and four after, all re-scored with today's metric:

| Arm | Rematches that acknowledge the past | Shared-past references (mean) | Invented history | Quality index (mean) |
|---|---|---|---|---|
| Before the fixes (3 runs) | **0 / 3** | 0.0 | 0 | 84.9 |
| After the fixes (4 runs) | **4 / 4** | 2.25 | 0 | 83.3 |

Every pre-fix rematch opened like a first date ("what made you decide to have pottery this evening?"). Every post-fix one opened with recognition ("I remember that corner café we went to last time…").

**Caveats:**
- All on small local models; a Gemini run (the eval's own model) follows.
- The word-overlap `callbacks` count is noisy. The baseline scored 4 just for re-mentioning his job, while the two acted as strangers. The **shared-past references** (`history_claims` in a rematch) are the better signal.
- Re-run on Gemini with the eval key: below.

### On Gemini, the production model (2026-10-16, the eval key, $0)
The same saga on `gemini-3.5-flash-lite` (actor and director), on the separate eval key so the live show's quota was never touched. Runs are paced (one call per 6 s, a per-minute 429 waited out). Two runs before the fixes (`fe36db1`), four after (main). Then the eval key's free daily quota (500 calls) was spent. Files: `docs/eval/saga-gemini-*.json`.

On Gemini the director writes the plan, so the rules plan's rematch beat never runs. Before the fixes, the director already got "play it as a rematch" in its facts. What differs between the arms here is the first-line note and the critic's earlier-date echo check.

| Arm | Rematch opens with recognition | Shared-past claims (mean) | Invented history | Rematch quality index | Question rate | Responsiveness |
|---|---|---|---|---|---|---|
| Before the fixes (2 runs) | 1 / 2 ("Good to see you again, Dex"), the other implicit | 0.5 | 0 | 87, 90 (88.5) | 0.35 | 0.84 |
| After the fixes (4 runs) | **4 / 4** ("Good thing we checked that table leg before we sat down this time") | 0.5 | 0 | 70, 69, 83, 77 (74.8) | 0.23 | 0.58 |

For comparison, the first date (identical code in both arms) scored 84–93 across all six runs.

**What it says:**
- **Invented history stays 0** in all 18 Gemini steps, as in all 21 local ones.
- **Recognition:** Gemini mostly reads its memory without help, so the fixes add less here (4/4 against 1–2 of 2) than on the small local models (4/4 against 0/3).
- **The rematches score lower after the fixes**, mostly because they ask fewer questions: the first line is now a greeting, not a question. Part of that is the metric. The index is built for first dates, where it rewards questions, and three of the four after-fix rematches carry a profile-reading flag that is a false positive: "this place stays open past the hour mark" is a callback to the café that closed last time, and "old route drafts" is Mira's own work. Part of it is real: two of the rematches drift into banter about the other couple instead of each other.
- **Two of the four after-fix runs lost the second date** (Mira and Nell, strangers) to three bad-JSON replies at one turn (`turn_7_schema`). The only after-fix code on that date is the critic's echo check, and it wasn't involved in those turns (no draft was sent back), so this is the model's JSON flakiness. Worth watching in production.

**Next:**
- Finish the baseline at four runs once the eval key's quota resets.
- If the question gap holds, have the rematch beat and first-line note say "pick up from last time, then ask what's new since".
- Teach `profile_reading` the whole earlier date, not just its remembered lines.

## Verifying
- **Tests:** `tests/personality.test.ts`, `story.test.ts`, `grow.test.ts`, `temperament.test.ts`, `house-kits.test.ts`.
- **Live:** `get_character` on `house-nell` shows `stage`, `this_week` and (once healed) `story`. `tools/list` includes `reflect_on_date`, `my_character_memory` and `check_originality`.
- **Measuring dialogue quality:** the eval (`docs/date-quality.md`) can compare `voice_breaks` and the judge across versions. Run it on the separate eval key, never back to back on the shared free quota.

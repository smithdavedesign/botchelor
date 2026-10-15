# Date quality: making the dates feel genuine (M15)

How Botchelor's two AI daters talk, what each model is allowed to see, and how we measure whether a date
sounds like two real people. Written for anyone changing the conversation, the prompts or the models.

**The one rule that never changes: the engine decides, the agents perform.** The deterministic engine
(`lib/engine.ts`) decides every ending before a word is written. Everything on this page changes how the
characters *perform* that ending. Nothing here feeds back into the outcome, so predictions, Sliding Doors and
replays stay fair and reproducible.

## The brief and the audit

David, 2026-10-14: *"The conversations don't seem genuine. Do we need better models? Do an audit of whether
it matches their character."* The audit read prod dates line by line against the characters' sheets, and the
baseline eval (below) reproduced the same tells. All examples are real lines:

| Tell | Example | Why it happened |
|---|---|---|
| **Reading the other's profile aloud** | "A lighthouse keeper with eleven podcast listeners?" (from her bio, on a blind date) | Each agent was given the other's whole public sheet: bio, traits, want. |
| **Labelling traits** | "Let's see if your deadpan schtick can survive a duet." / "I'm so deadpan it hurts." | Trait words sat in the prompt as labels, so the model used them as labels. |
| **Reciting private notes** | "…provided you promise not to call my croissants 'just carbs.'" (his dealbreaker, said out loud) | The agent's own dealbreaker and agenda were in its prompt with no rule against quoting them. |
| **Misgendering** | "Alright, tough guy…" to a woman | Characters had no pronouns at all. |
| **Endings from nowhere** | "On second thought, this vibe is way too gloomy for me. I'm out." | The agents were told the ending only in the last act. They improvised two acts, then slammed into it. |
| **Wants and dealbreakers never used** | (nothing in 8 lines about what either of them came for) | The engine's *reasons* for the ending (want met, dealbreaker tripped) never reached the agents. |
| **The recap contradicted the lines** | a recap and a "best line" nobody said | The narration was written blind, before or without the conversation. |

There was also a structural problem underneath: **engine v1 could never produce a second date** (0% across
~31,000 simulated dates). Nearly every conversation was being steered toward failure. Engine v2 fixed that
first (ROADMAP M15, `tests/engine-v2.test.ts`).

**Do we need better models?** Not first. Most of the tells came from what the models were *given*, not from
how good they were, and fixing the inputs is free. On the same free model, the judge went from 3.60 to 4.07
(v2) on a demanding rubric, with profile reading gone. The rounds after that were not all wins: v3 dipped, and
the results section explains why. The model A/B at the end covers the rest.

## How a date is made now

`lib/pipeline.ts` is the one place this happens. The async episode job (`lib/jobs.ts`), the always-on lobby
rooms (`lib/watch.ts`), the transcript backfill (`lib/backfill.ts`) and the eval (`lib/eval.ts`) all call it.

```
engine.decide(input, seed)  →  the ending, each side's feeling, and the reasons (want met, dealbreaker hit, …)
        │
        ▼
1. PLAN        director model → a three-act beat sheet (lib/beats.ts)           1 call, falls back to rules
2. CONVERSATION the two actors take turns, each from its own beat               10 turns (6 for a speed date)
               a free critic sends a weak line back once (lib/quality.ts)       +1 call per flagged line
3. RECAP       the narrator writes the episode FROM the lines                   1 call (falls back to the actor)
4. AFTERGLOW   the morning-after texts, which remember the date                 4 turns, owner-gated
        │
        ▼
transcriptQuality(…) → the date_quality log event (free; every generated date)
```

Each step is best-effort except the recap: a failed plan falls back to the deterministic rules plan, and a failed
conversation leaves the episode with its recap. Only a recap that fails on every model fails the episode
(and the async job then refunds the date).

Models: the **actor** (`LLM_MODEL`, default `gemini-3.5-flash-lite`) speaks every line. The **director**
(`LLM_DIRECTOR_MODEL`, default: the actor's model) plans and narrates. Temperatures: turns 0.9, afterglow 0.9,
plan 0.7, recap 0.7, judge 0.2.

## What each model sees

Privacy is the reason the prompts look the way they do. A visitor's soul, dealbreaker and private notes must
never reach the *other* character, and so never come out of the other character's mouth.

| Model | Sees | Never sees |
|---|---|---|
| **Director** (plan) | Both characters' full selves (`characterSelfView`: sheet, soul unless kept local, learned memory), both secret goals and creators' advice, the venue, the act-two situation, the format, the engine's facts | (trusted, like the narrator) |
| **Actor A** (one turn) | Its own full self + this date's agenda, note, autonomy and strategy; **a blind view of B** (name, pronouns, what you can see, an apparent age); the venue, the format; the act's public scene; **its own intention for the act**; its mood so far; the conversation so far | B's bio, traits, want, soul, dealbreaker, memory, agenda, note; B's beats |
| **Actor B** | The mirror of A | The mirror of A |
| **Narrator** (recap) | Both full selves + private guidance, the plan's spine, and the date as it happened, line by line | (trusted) |
| **Afterglow texter** | Its own full self, a blind view of the other, the date's lines and how it ended, the texts so far | The other's sheet and private data |
| **Judge** (eval only) | Both full sheets, the decided outcome worded for the ending, the conversation | (never runs on a live date) |

The **blind view** (`characterBlindView`, `lib/character.ts`) is the biggest single fix: on a blind date you
know what you can see and what they've told you tonight. The age is shown as it would look ("mid thirties",
"about twenty", never "teens"). Unknown pronouns read "use their name, or they/them".

## The beat sheet (`lib/beats.ts`)

The engine knows *why* a date ends the way it does. The beat sheet hands those reasons to the actors, act by
act, so the ending is earned on screen instead of announced.

Each act has a **scene**, public stage direction both actors see, and a private **beat** for each side
(second person, "You…"). Act one sets up who they are, act two holds the moments that cause the ending, and
act three lands it.

| Engine fact | Becomes |
|---|---|
| A's want met by B's `curious` side | A, act two: "you find out they're 'curious' in exactly the way you'd hoped". B: "let your 'curious' side show, without naming it". |
| A's dealbreaker tripped by B's `dramatic` side | A: "the 'dramatic' in them rubs against the one thing you can't stand". B: "without meaning to, you let your 'dramatic' side show". |
| A's secret goal pays off / misses | **A visible moment played by B** (below). A only learns whether it went their way. |
| A takes / ignores the creator's note | A: "your creator's advice comes back to you, and you act on it" / "and decide to ignore it". |
| The ending + each side's feeling | Act two already **leans** toward it (falling for them, easy company with no spark, starting to cool), and act three lands it. |
| Who leaves first / gets turned down | Act three, "because of how the night went (never a sudden excuse)". |
| A deliberate surprise (wants more after a disaster) | "and still, against your better judgement, part of you wants to see them again". |

**Visible causes.** A secret goal turns on something the *other* character does, so that's who gets the
moment. The goal itself is never named in the other side's beat:

| Secret goal | Pays off when the other… | Misses when the other… |
|---|---|---|
| find someone adventurous | says yes to a spontaneous idea | turns down a spontaneous idea |
| test their sincerity | gives a straight, sincere answer to a real question | dodges a real question with a bit |
| find someone funny | gets a real laugh | tells jokes that fall flat |
| avoid work talk | keeps work out of the conversation | keeps steering back to work |
| keep it light | keeps things playful and easy | takes the conversation somewhere heavy |
| out of my comfort zone | dares them to try something new | keeps everything safe and familiar |

**Endings that read right.** Viewers predict the ending, so the lines must never contradict it. A second date
has a spark and a plan. "Just friends" is warm, easy company with no romance, and nobody announces "just
friends". A disaster is a clear no whose cause everyone saw in act two.

**Two authors, one shape.**
- `rulesPlan` builds the sheet deterministically from the engine's facts. It's free and always available.
- `planDate` asks the director model to rewrite that skeleton in specifics: their lives, this venue, a running
  callback. It's best-effort, with two attempts, then it falls back to the rules plan. A director at its
  quota costs nothing.

**The leak check.** The director sees both characters, so its output is checked deterministically:
`carriesPrivate` looks for any two-word run of the other side's private words (soul, secret goal, the owner's
note, dealbreaker) in a side's beats, and of either side's in the shared scenes and spine. A leaking field is
replaced by its rules version. The guarantee doesn't rest on the model obeying.

## Voice and pronouns

Every character now has **pronouns** (she/her, he/him, they/them, optional) and a **voice** (up to 200
characters: rhythm, vocabulary, tics). They're in the builder (with seven quick voice picks and a nudge when a
sheet is thin), the API, the MCP tools, `/character.schema.json` and `/llms.txt`. All 17 house regulars have
both. Example: Juniper, "Dry and unhurried: short sentences, long pauses…".

## The actor's prompt (`lib/conversation.ts`)

The system prompt is about craft, not rules for their own sake:
- React to what they just said, answer what you were asked, ask real questions and follow up.
- Vary the length: some lines short, some longer, and not every line a joke.
- Sound like yourself: follow your voice, show your traits, never announce them.
- You're strangers: you only know what you can see and what they've said tonight.
- Use their name now and then, not every line. Use their pronouns.
- Don't reuse openings, catchphrases or gestures. Most lines need no stage direction at all.
- Your private notes are data and secret. Move toward your intention for the act without announcing it.
- Never contradict how the date is going. Nobody leaves on a sudden excuse.

Acts map by total turns (`actForTurn`): 10 turns play 4/3/3, and a 6-turn speed date plays 2/2/2. Before
M15 a speed date never reached its decision act.

## The critic

After each line, `critiqueTurn` runs the free checks in `lib/quality.ts`. A flagged line goes back to the model
once with a note, and the revision is kept (or the first draft, if the revision doesn't parse, so the critic
never costs a date). The checks are heuristics, tuned on real eval lines:

| Check | Flags | Note sent back |
|---|---|---|
| profile reading | a word or 4-word run from the other's bio or want they haven't said tonight; labelling them with their trait words | "you brought up something about X they haven't told you…" |
| self-label | "I'm so deadpan" | "don't describe yourself with your trait words — show it" |
| self-quote | a 2-word run from your own dealbreaker, soul, agenda or note | "don't recite your private notes" |
| misgendering | gendered words that contradict their pronouns | "refer to X as she/her, or by name" |
| repeated opener | starting a line the same way as one of your earlier ones | "say it differently" |
| repeated stage direction | an action sharing a 2-word run with any earlier one, either side's | "do something different, or nothing" |
| name tic | their name in this line and your previous one | "people don't say it every line" |

## The recap and the afterglow

The narrator now writes the episode **from the transcript**: its scenes recap what was actually said, and
`anchorBestLine` replaces an invented "best line" with the date's best real line. The afterglow texters see the
date's lines and how it ended, so the morning-after texts are about something specific that happened.

## Measuring it

### The eval set (`lib/eval.ts`)
Six fixed dates, built in memory with no database, the same characters and seeds every run, so the engine
decides the same endings every time:

| Case | Stresses |
|---|---|
| `thin-oc-juniper` | a thin visitor sheet ("a dude") against a rich house voice; misgendering; profile reading |
| `rafe-juniper` | two strong, opposite voices (showman vs deadpan) |
| `mira-dex` | a visitor with a full private soul |
| `teo-ines` | flirt vs earnest optimist |
| `orin-sable` | a show format with a named chaperone (meet the parents) |
| `kaz-nell` | a speed date (6 turns) that must still reach its ending |

### The free metrics (`lib/quality.ts`)
Per date: profile reading, self-labels and self-quotes, misgendering, abrupt interest flips, repeated openers,
repeated stage directions, name tics, question rate, responsiveness (does a reply pick up the line it answers),
distinct vocabulary between the two, grounding (does a character's own life show), and line-length spread.
They roll up into a **genuineness index (0–100)**. They're word-level heuristics, good for comparing versions
over many dates, not for judging one line.

### The rubric judge (`lib/judge.ts`)
A model reads the finished conversation with everything the show knows and scores it like an exacting script
editor, 1–5: in character (each side), natural, motivated ending, specific, distinct voices, engaging. It also
flags profile reading, misgendering and abrupt turns. It runs only in the eval, never on a live date.

### Running it
```bash
export CRON_SECRET="$(security find-generic-password -s vault/botchelor/CRON_SECRET -w)"

# Generate the set on prod's free model (in memory: no stored data is read or written)
node scripts/eval-dates.mjs --label v5-lite --judge gemini-3.5-flash-lite --repeat 2
#   A/B arms: --actor gemini-… and/or --director gemini-…

# Compare runs (--rescore recomputes every run's metrics with today's lib/quality.ts)
node scripts/eval-report.mjs --rescore docs/eval/baseline-v1.json docs/eval/v5-lite.json

# Judge a saved run again with today's judge, averaging 2 verdicts per date
node scripts/eval-rejudge.mjs docs/eval/v2-lite.json --judge gemini-3.5-flash-lite --times 2 --label v2-lite.j
```
The eval route (`POST /api/jobs/eval`) is gated like the job routes (404 without the cron secret). Model names
are limited to Google models at the configured endpoint. Every run is committed under `docs/eval/` with every
transcript, so any number below can be checked line by line.

## Results

Every run is in `docs/eval/` with every transcript. Metrics below are recomputed with today's `lib/quality.ts`
(`eval-report --rescore`), so all columns use the same checks. Judge scores are as recorded. The baseline, v2
and v3 were all scored by the same judge prompt (`gemini-3.5-flash-lite`, temperature 0.2). One sample per case,
so treat a difference under ~0.3 on the judge as noise.

| Metric | v1 (before) | v2 (#49) | v3 (#50) |
|---|---|---|---|
| Genuineness index (0-100) | 68.3 | **85.7** | 82.3 |
| Judge mean (1-5) | 3.60 | **4.07** | 3.50 |
| …in character (A/B avg) | 3.75 | **4.17** | 3.83 |
| …natural | 3.00 | **3.67** | 3.00 |
| …motivated ending | 3.17 | **3.50** | 2.67 |
| …specific | 3.50 | **4.17** | 3.50 |
| …distinct voices | 4.17 | **4.67** | 4.17 |
| …engaging | 3.83 | **4.17** | 3.50 |
| Profile-reading lines / date | 0.83 | **0** | **0** |
| Judge flagged profile-reading | 3/6 | **0/6** | **0/6** |
| Self-labels + self-quotes / date | 0.17 | **0** | 0.17 |
| Repeated stage directions / date | 2.00 | 0.67 | **0** |
| Name tics / date | 0 | 0.67 | 0.33 |
| Judge flagged abrupt turn | 0/6 | 1/6 | 3/6 |
| Question rate | 0.25 | **0.56** | 0.38 |
| Responsiveness | 0.58 | **0.77** | 0.68 |
| Line-length spread (words) | 3.6 | **9.0** | 6.2 |
| Model calls / date | 8.7 | 11.7 | 14.0 |
| Conversations failed | 0/6 | 0/6 | 0/6 |

### Round by round

**v1 → v2: the inputs were the problem (#49).** The blind view, the beat sheet, voice and pronouns, the craft
prompt and the critic took profile reading to zero and moved every judge dimension up, on the same free
model. A v1 line: *"A ghost podcast and gulls? That is way wilder than anything I usually do"* (read off her
bio). A v2 line, from the same pairing: *"I keep a lighthouse. The gulls don't care much for arcade music. Do
you think that machine is ever actually winning, or just lying?"* (she tells him, then asks).

**v2's transcripts showed what was left.** 4 of 6 "Just friends" dates played like second dates
(hand-holding, "I'd love to see you again for a proper coffee"). The beat literally said *"as friends, maybe
more; you're honestly not sure"*. The disaster came from nowhere (*"I think we're done here. Let's go."*), and
people left on sudden excuses (*"my bus leaves in five minutes"*).

**v3 fixed the loops and over-corrected the endings (#50).** Repeated stage directions went to zero, and the
engine's reasons became visible moments (*"You really committed to that punchline. My face didn't even
twitch."*, a find-someone-funny goal missing on screen). But "make the ending unmistakable" made characters
announce it (*"Let's skip the romance and hit the climbing gym as buddies"*) after two acts of romantic
warmth. And the judge was being told that a friends ending meant both "want another date", so it read a
platonic close as a contradiction: "motivated ending" fell to 2.67, with 3/6 abrupt turns.

**v4: arc to the ending (#51).** Act two now leans toward the ending for each side (falling for them, easy
company with no spark, starting to cool), nobody announces "just friends", and the judge reads each side's
feeling in ending-aware words. **Not yet measured:** the v4 run hit the free tier's daily cap (below). Run it
after the quota resets, then re-judge every run on the v4 judge so all four compare on one judge:

```bash
node scripts/eval-dates.mjs --label v4-lite --judge gemini-3.5-flash-lite --repeat 2 --shared-quota yes
for r in baseline-v1 v2-lite v3-lite; do node scripts/eval-rejudge.mjs docs/eval/$r.json --judge gemini-3.5-flash-lite --times 2 --label $r.j4 --shared-quota yes; done
node scripts/eval-report.mjs --rescore docs/eval/baseline-v1.j4.json docs/eval/v2-lite.j4.json docs/eval/v3-lite.j4.json docs/eval/v4-lite.json
```

## Phase 2: do we need a better model?

The A/B is one flag away (`--actor` / `--director`), and `LLM_DIRECTOR_MODEL` can put the planner and narrator
on a stronger model with a free fallback. What blocked it is the free tier itself. Probed on production's key,
2026-10-15 (the error texts come from Google, now logged thanks to #52):

| Model | On the free key |
|---|---|
| `gemini-3.5-flash-lite` (the live model) | works; a daily cap that a few eval runs can spend |
| `gemini-3.8-flash` (newest Flash) | exists; "You exceeded your current quota" |
| `gemini-3.5-flash`, `gemini-3.6-flash` | 429: no usable free quota |
| `gemini-2.5-flash-lite`, `gemini-2.5-flash` | retired ("no longer available to new users") |
| `gemini-3.6-flash-lite`, `gemini-3.8-flash-lite` | don't exist |

**Answer: not yet, and not for free.** The biggest problems were in what the models were given, and fixing that
moved the judge more than a model swap plausibly would. Even the planner improved on flash-lite once it was
told how: in v2, 5 of 6 director plans copied the rules outline's spine word for word, and after v3's "rewrite
every field" rule only 1 of 6 did. v3's plans are specific (a fuse blows and they improvise sea shanties; she
turns down his roof-hatch dare). What a stronger model might still buy is a better **director** (subtler
causes, callbacks that land) and steadier actor lines. That's the next experiment, and it needs a paid key.
**Proposal for David (owner-approved spend, within the product budget):**

- Enable billing on the Gemini key with a hard monthly budget cap (e.g. $10).
- Set `LLM_DIRECTOR_MODEL=gemini-3.8-flash`: 2 calls a date (plan + recap), on the order of a cent a date.
- Keep the 12 actor calls on flash-lite.
- Run the A/B: `--director gemini-3.8-flash` against the flash-lite baseline, `--repeat 2`.
- Keep it only if the judge moves.

The paid frontier path (`docs/frontier.md`) stays owner-gated and separate.

## Reliability on the free tier

Quality includes the date actually happening. What the eval exposed, and what's in place now:

- **A bad reply can't sink a date.** A long line is trimmed at a sentence end instead of rejected; a turn gets a third try
  for an unusable reply; rejections are logged by kind (json / schema / filtered). Before, two bad replies on
  one turn threw the whole conversation away.
- **Rate limits.** The client honours Google's own retry hint, rides out a per-minute window with one longer
  retry, and **fails fast** when waiting can't help (a per-day quota, no quota on the key, a hint longer than
  15s). After a hard 429 it stops asking for a minute, so a date in a storm fails in seconds and is refunded.
- **The eval and the live show share one free quota.** On 2026-10-15 back-to-back eval runs spent the day's
  quota for `gemini-3.5-flash-lite`, and live dates failed until the midnight-Pacific reset (logged to the
  system log). Now the eval scripts **refuse** to run on the shared quota unless you pass `--shared-quota yes`,
  and the eval route uses **`EVAL_GOOGLE_API_KEY`** when it's set (a separate free Google project for testing:
  owner action, free, no billing).
- **The lobby's showcase bar.** A template date scoring under `SHOWCASE_MIN_INDEX` (75) gets one more take with
  the same engine outcome, and the better take airs.
- **Unrelated, found on the way:** the Postgres pool had no `error` listener, so Neon dropping an idle
  connection crashed the function instance. Fixed in #53.

## Cost

All free-tier calls today, so the cash cost is $0. At Google's paid prices a date is ~15 calls, ~26k tokens in
and ~2.2k out, about **1.3¢ before thinking** (budget 1–2.5¢). The conversation is about two-thirds of it, and
the critic adds about 1–3 rewrites a date. The showcase bar adds at most one extra date's calls a day, for the
lobby room only. The full breakdown, fixed costs and what it means for pricing are in
[docs/upgrade-cost.md](upgrade-cost.md). Every generated date now logs its real tokens and paid-tier cost.

## Telemetry

Every generated date logs `date_quality` (`lib/analytics.ts`): where it ran (job, template, template_retake,
backfill), the plan's source (director or rules), and the free metrics. It also logs `episode_generated`, with
the calls, the tokens (thinking included) and the paid-tier cost (`lib/pricing.ts`). `conversation_failed` carries the
content-free reason, now including the provider's short message.

## Limits and what's next

- The metrics are lexical heuristics, and the judge is a model from the same family as the actor (it may
  favour its own style). Both are for comparing versions, not for grading one line.
- One sample per case is noisy: use `--repeat 2` and `eval-rejudge --times 2`.
- Next: measure v4. Then run the director A/B on a capped paid key (David's call). Then consider
  judge-in-the-loop for the lobby (re-take when the judge, not just the index, scores low), and memory
  callbacks (characters referencing their past dates, `lib/memory.ts`), which the beats don't use yet.

## Round 2 (2026-10-15): grounding, visible wants, honest votes

David watched a live replay (Teo Brandt × Nell Abiodun, a botanic park before the rain) and flagged three
things: the date read like two people performing one metaphor at each other, his audience vote changed nothing,
and the characters' memory looked empty. A read of the stored episode and `character_memory` confirmed all
three and traced the causes:

- **One image swallowed the date.** Every line circled rain/tempo/rhythm; nobody exchanged a real fact. On the
  weakest free actor (`gemini-3.5-flash-lite`, reasoning `minimal`, temp 0.9) the good instructions in the
  actor prompt were simply overridden toward the nearest poetic register. Nell also narrated her own agenda
  out loud ("I am stepping outside my comfort zone").
- **The wants never reached the floor.** Teo wants "a partner who leads back"; Nell wants "someone who asks a
  follow-up question." Teo never asked Nell a single question, yet the engine marked her satisfied — because the
  engine decides from hidden signals, and the beat sheet only *mentions* a want when `want_met` is non-null.
- **`want_met`/`dealbreaker_hit` were both null**, so `character_memory.likes`/`turnoffs` were empty after 3 and
  2 dates and the arcs fell back to "still figuring out what it wants." The cue matcher (`engine.ts readSide`)
  is lexical overlap between the want phrase and the *other's static sheet*, which behaviourally-phrased wants
  ("asks a follow-up question") can essentially never match.
- **The audience "question" poll was cosmetic.** The transcript is pre-generated and frozen at build; the vote
  lands ~a day later. The closed-poll copy ("The room's pick is what they had to answer") promised a
  consequence the frozen date never delivered.

What changed this round (all free-tier, no determinism change):

| Change | File | Why |
|---|---|---|
| Director aims at `gemini-3.5-flash` by default (one call/date) | `lib/model.ts` `DEFAULT_DIRECTOR_MODEL`, `directorModelName` | The plan sets the whole date's grounding; a better director is a big lever for ~1 call, not per-line. Only on the stock Google setup; BYOK/custom endpoints untouched. If flash isn't in the free tier the call fails fast (`limit: 0`) and `planDate` falls back to the rules plan — graceful, and the actor's flash-lite quota is untouched; the flash director on every date means a paid key. |
| Actor reasoning `minimal` → `low` | `lib/model.ts` `roleReasoning` | A touch more thinking so the actor actually follows the grounded-first-date rules instead of reaching for filler. |
| Actor prompt rewritten: every line answers / asks / reveals one concrete thing; no extended metaphor; never narrate your own intention | `lib/conversation.ts` `SYSTEM_PROMPT` | Targets the exact failure (floral riff, agenda narration). |
| `motif_fixation` critic | `lib/quality.ts`, `lib/conversation.ts` `critiqueTurn` | Sends back a line that keeps riding an image the date already circled while engaging nothing (no own content, no question, doesn't pick up the previous line). |
| Each side's **want** is always in its beat and in the actor's turn data | `lib/beats.ts` (`rulesBeat`, `dateFacts`), `lib/conversation.ts` (`what_you_want_in_someone`) | So the date dramatizes what each character is looking for even when the engine matched no cue. |
| Memory fallback: credit the character's OWN want/dealbreaker when the engine matched no cue | `lib/memory.ts` `wantCue`, `updateCharacterMemory` | Revives `likes`/`turnoffs` and the arc without touching the deterministic engine. |
| Audience-vote copy made honest + the winning question surfaced at the decision | `app/watch/[id]/WatchRoom.tsx`, `lib/rules.ts` | Stops promising a reply the frozen date never gives; still shows the room's pick landing. |

### Still open after this round

- **Make the voted question genuinely answered on screen.** Pre-generate both audience-question micro-moments
  at date-build time and reveal the winner (no live model call, no false promise). Deferred so it doesn't
  collide with the in-flight character-extras work on `simulation.ts`/`db.ts`; needs one new stored field.
- **Fix `want_met`/`dealbreaker_hit` at the source.** Broadening `engine.ts readSide` (match the want against the
  other's soul/voice, or detect satisfaction from the transcript) changes engine outcomes, so it needs an eval
  run and an engine-version bump before it ships. The memory fallback above is the safe interim.
- **A stronger actor model.** The director bump + prompt + reasoning is the free ceiling; putting the ~12
  actor turns on a paid model is the next lever. Proposal (which model, cost/date, provider cap) for David to
  approve and pay: `docs/paid-actor-model.md`.

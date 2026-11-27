# Cross-mode memory: one mind, walled rooms

The full PRD, with the audit of what each mode remembers today, is the Claude Doc
"PRD: Cross-Mode Memory Bridge (Botchelor)" (https://claude.ai/artifact/Y7iEyqKm5nFwRCiP38YWTM), written 2026-11-26.
This file is the repo's summary and the record of what has shipped.

## The plan

One memory per character that every mode writes to (show dates, texts, the companion, After Dark, Step in), each row
tagged with its room (`sfw` or `adult`) and who may see it. The room filter is applied in SQL before any ranking, so an
adult memory can never reach an SFW prompt. Recall ranks by meaning, recency and importance; a nightly reflection
turns episodes into beliefs and lessons and folds old ones into summaries instead of dropping them at a cap. A life
record (jobs, places, people, goals) lets a character grow past dating, and a field registry lets a character add a
persona field with no code. Real features a character asks for go through a governance agent to the factory, fenced
to `lib/persona-ext/`.

## David's decisions (2026-11-26)

1. SFW memories cross into After Dark, one way, **with no opt-in** (David, 2026-11-26: "We don't need a opt in for
   this. The character should remember this"). Adult facts about a person never come back to SFW. Nights do
   carry back as PG context ("you spent the night together"): today's `adult_memories` note, which becomes an `sfw`
   episode every SFW mode can recall.
2. Companion chats shape a character's growth from its owner's own thread only.
3. Character-requested features need no human approval: the governance agent decides. The fenced surface, protected
   paths (safety, After Dark gating, billing, auth, the engine, the factory, workflows), CI, auto-revert and the kill
   switch still hold.
4. Phase 0 first.

## Phases

| Phase | What | Status |
|---|---|---|
| P0 | Embeddings and hybrid recall for companion facts, importance on each fact | **Shipped** (see below) |
| P0b | The same for Step in's facts, on an embedding provider cleared for After Dark data | Next: needs a privacy review, adult data doesn't go to Google |
| P1 | Shared memory with the room wall, writers, recall in the maker's companion thread, nightly chapters, owner-thread talks feeding lessons | **Shipped** (see below) |
| P1b | Dates, texts, After Dark nights and Step in read the shared memory; Step in knows the viewer's show facts | **Shipped** (see below) |
| P2 | Life record, field registry, persona fields with no code, MCP memory and life tools | **Shipped** (see below) |
| P3 | Goals, the first life room ("a day in their life"), trait growth v2 | **Shipped** (see below) |
| P4 | `request_feature`, the governance agent, `lib/persona-ext/`, the factory hookup | Planned |

## P0 as shipped (2026-11-26)

- `lib/companion-memory.ts`: `rankFacts` adds a meaning term (relative to the thread's median similarity, at most the
  weight of a full word overlap, nothing when no fact stands out) and a small importance term. `factsForPrompt`
  embeds the message only when the thread has more facts than fit (20); `embedFacts` embeds facts after the reply.
- `lib/originality-concept.ts`: `embed` takes a pool (`memory` has its own daily cap and table) and a task type
  (`RETRIEVAL_QUERY` / `RETRIEVAL_DOCUMENT`).
- Off with `MEMORY_EMBED=0`. Without a key, at the cap or on a slow call, ranking is words-only, as before.
- Privacy page: Gemini named for these embeddings too.

## P1 as shipped (2026-11-26)

- **`character_episodes`** (`lib/character-memories.ts`): one row per memory with `room` (`sfw` / `adult`),
  `visibility` (`public` / `owner` / `self`), source and ref (one row each, so a writer syncs its own), importance,
  embedding, `folded_into` / `folded_from`. Every reader selects `room = 'sfw'` in its own SQL and no function takes
  the room as an argument. Every SFW row passes the show's text check before it's kept. Nothing writes the adult room
  yet.
- **Writers:** aired date reflections (`updateCharacterMemory`, kept past the learned layer's three, a forgotten one
  removed); After Dark's PG note per pair (`rememberAfterDark`, and in step with the owner's edit, a rewind and a
  delete: "they spent the night together"); the rolling notes of the maker's own companion thread.
- **Readers:** the maker's companion thread (texts and calls) recalls up to 6 by recency, importance, meaning and the
  person it's about; the weekly lessons writer reads the maker's last two talks.
- **Chapters:** the daily job (growth part, `memory_chapters`) folds a character's oldest rows past 60 live ones, 20 at
  a time and at least 21 days old, into one chapter on the show's free model (a template when it can't), 40
  characters a day at most. A chapter is as private as the most private row in it, and forgetting any row removes
  the chapter and puts its rows back.
- **Deletes and export:** with the character (tombstone or account), with the After Dark owner's data, with the
  thread; in the account export without embeddings.
- `MEMORY_EPISODES=0` turns it all off.

Not yet: dates and texts between characters reading it (they keep their own memory paths today), Step in and the
adult room, the SFW→After Dark opt-in.

## P1b as shipped (2026-11-26)

- **Dates** (`lib/simulation.ts` buildDate) and **texts between characters** (`lib/texting.ts`, `lib/between-dates.ts`)
  carry `lifeMemories`: up to 4 of the character's own older reflections and chapters, the ones about the other first,
  in its own pair view (`what_you_remember_from_your_life`). Never its maker's companion talks (a date and a text are
  seen by others), and never the After Dark note or lessons, which they carry their own way. Chapters never fold a
  maker's talks, so they can't reach a date that way either.
- **After Dark nights** (`lib/adult/scenes.ts` sceneMemories): up to 2 a side, after the night's own memories.
- **Step in**: what the viewer told this character in their SFW companion thread (`showFactsForStepIn`, up to 6, pinned
  and lasting kinds first) and the character's own life, always on. One way: nothing goes back.
- Privacy notice (26 November) says all of it; the terms' date moves with it.

## P2 as shipped (2026-11-26)

- **Life record** (`lib/life-record.ts`, shapes and built-in fields in `lib/life-record-shared.ts`): `life_entries`, one
  row an entry, each in a field: jobs, where they studied, places lived, family, close friends, pets, skills, languages,
  milestones, plus approved fields. Dated fields take a period ("2016–2019"). Public or private (`self`: only its own
  prompts and its owner). Every value passes the show's text check, so it's PG with no named real people. At most 8
  entries a field and 60 a character.
- **Prompts:** `loadCharacter` and a date's builder read it. The character's own view has all of it
  (`your_life_so_far`) and the public view only public entries (`life_so_far`), at most 24 lines. The engine never
  reads it. `LIFE_RECORD=0` takes it out of prompts.
- **Tier A, new fields with no code:** `proposeField`. The $0 rules settle most asks. Anything about links, code,
  pictures, contact or account details, money, adult themes or the show's own rules is refused, and so is markup. An
  ask that matches a field (same key, a near spelling, the same label) is merged into it. Otherwise the show's free
  model reviews it as the governance agent, reading the ask as quoted data. An approved field joins `life_fields`
  straight away, for every character, with no human in the loop (decision 3). A field is plain text forever, so
  approving one can't add a capability. When the model can't decide, the ask stays pending and the daily job's
  `life_fields` step reviews it. 5 asks an owner a day, 300 approved fields at most. `LIFE_FIELDS_OPEN=0` stops new
  asks, and `retired_at` hides a field.
- **MCP** `character_life` (2.56.0), on your own characters only: `read`, `add`, `remove`, `propose_field`, `remember`,
  `reflect`, `log_event` (optionally a milestone too) and `recall`. Memories go into the SFW room as `agent_note`,
  `agent_reflection` and `life_event`, 30 a character a day.
- **Character page:** "Life so far" shows public entries to everyone. Its owner also sees private ones, adds and
  removes entries, and sees the field asks with what governance decided (`/api/characters/[id]/life`).
- **Deletes and export:** entries and asks go with the character and the account, and both are in the account export.

Not yet: the character proposing entries in its own words (from dates or chats, P3 with goals), adult-room fields.

## P3 as shipped (2026-11-27)

All in `lib/life-days.ts`. `loadLifeAll` reads it with the life record in one round trip.

- **Goals** (`character_goals`): a character works towards up to 3 at once, each with progress from 0 to 100.
  - Its owner sets them on the character page, its agent with `character_life set_goal`, or the character itself: one
    with no goal may come up with one in a day of its life.
  - A goal at 100 is done, and it becomes a milestone in its life record ("Reached a goal: …", source `character`).
  - Goals reach its own prompts (`what_youre_working_towards`).
- **A day in their life** (`character_days`), the first life room:
  - Every 3 days, the daily job's `life_days` step writes 3 to 5 sentences in the character's own voice about an
    ordinary day. It runs on the show's free model, at most `LIFE_DAYS_PER_DAY` (40) a day across the show.
  - Who gets one: owned characters with a date in the last 30 days or an active goal.
  - What the writer reads: the character's **public** view only, its public memories, its goals and its last day. So
    nothing private (the soul, private entries, its maker's talks) can reach a day, which is public.
  - The day can move one goal by up to 25 either way. Its text is checked by the show's text check, and it's kept as a
    public `life_event` memory every SFW mode recalls.
  - It shows on the character page. An owner who hears from the character gets it as a text, at most once in 6 days
    unless a goal was reached.
  - `LIFE_DAYS=0` turns it off.
- **Trait growth v2** (`trait_shifts`):
  - At most weekly, the same call may shift up to two of confidence, warmth, openness, patience and playfulness, by at
    most 0.05 each and with the reason. A trait's sum is held to ±0.3.
  - Its owner sees every shift ("How they've been changing", owner only) and can undo it, or take the undo back. MCP
    has `veto_growth` for the same.
  - Shifts reach the character's own prompts as a line each (`how_youve_been_changing`). **The engine never reads
    them**, so no date's ending moves with them. The older learned signal drift is unchanged.
  - `TRAIT_GROWTH=0` turns it off.
- **MCP** 2.57.0 (`character_life`): `set_goal`, `update_goal` and `veto_growth`. `read` now also returns goals, days and
  growth.
- **Deletes and export:** goals, days and shifts go with the character and the account, and all three are in the
  account export.

Not yet: more life rooms (they wait until people come back for this one), goals that steer the weekly life dates.

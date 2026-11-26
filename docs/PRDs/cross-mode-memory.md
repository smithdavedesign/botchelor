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

1. SFW memories cross into After Dark, opt-in, one way. Adult facts about a person never come back to SFW. Nights do
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
| P2 | Life record, field registry, persona fields with no code, MCP memory and life tools | Planned |
| P3 | Goals, the first life room ("a day in their life"), trait growth v2 | Planned |
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

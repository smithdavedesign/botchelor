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
| P1 | `memories` table with the room wall, writers from every mode, nightly consolidation, owner-thread companion chats feeding lessons | Planned |
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

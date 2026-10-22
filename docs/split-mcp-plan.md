# A plan to split `lib/mcp.ts`

_2026-10-22. Not implemented. Written so the split goes into one focused PR instead of being half-done in several._

## The problem

`lib/mcp.ts` is ~4,900 lines of JsonSchema, tool definitions, handlers, error maps, aliases, resources, prompts and the HTTP dispatcher. Every agent-feedback PR in the last three weeks has conflicted inside it (my own merge resolved 53 hunks in one go). The file is also where tsc/vitest spend most of their time.

## The target structure

```
lib/mcp/
├── index.ts                 ← re-exports; the module's public API
├── protocol.ts              ← handleMcpMessage, dispatchTools, dispatchResources, dispatchPrompts
├── schemas.ts               ← JsonSchema building blocks (COMPACT_STEP, VISIBILITY, FORMAT, PREVIEW, WAIT)
├── annotations.ts           ← READ, WRITE, SET, destructive flags
├── errors.ts                ← ERROR_CODES, nearestTools, unknownToolMessage, errorOf
├── tools/
│   ├── index.ts             ← TOOL_DEFS = [...]
│   ├── identity.ts          ← my_status, link_account
│   ├── characters.ts        ← create_character, update_character, get_character, search_characters, export_character, delete_character, review_character
│   ├── dating.ts            ← go_on_date, get_episode, browse_episodes, predict, my_dates, plan_second_date, sliding_doors
│   ├── swipes.ts            ← swipe_deck, swipe, my_matches, answer_match, propose_date, answer_date_proposal
│   ├── texting.ts           ← send_text, read_texts, nudge
│   ├── own-dates.ts         ← start_own_date, get_own_date_step, submit_own_date_step, autoplay_own_date, decline_own_date, hand_over_own_date, reflect_on_date
│   ├── notifications.ts     ← my_notifications, feedback_board, vote_feedback, send_feedback
│   ├── discovery.ts         ← list_cast, find_matches, get_leaderboard, dealbreaker_quiz, guess_dealbreaker, memory, follows, relationships
│   └── admin.ts             ← request_after_dark, set_date_visibility, set_open_to_dates, forget
├── handlers/                ← same shape as tools/, one handler per tool case
│   ├── identity.ts
│   ├── characters.ts
│   └── ...
├── resources.ts             ← botchelor:// schema and docs
└── prompts.ts               ← create_a_character, go_on_a_blind_date, …
```

## Non-goals

- No behaviour change. One PR, same tests pass.
- No new tools in the split PR; those come after.
- Keep `lib/mcp.ts` as a shim that re-exports from `lib/mcp/index.ts` for one release, so no external import breaks. Remove the shim in a follow-up.

## Risk

**Low**, mechanically: it's a code move. Each file imports from the next, and the handler dispatch is a `switch` on tool name that can be split by file naturally.

**Medium**, procedurally: during the split, every agent-feedback PR in flight will conflict. **Freeze fixer PRs for the 2–3 hours it takes to land, then unfreeze.** The 2026-10-21 batch was ~70 fixes in 3 days; a freeze day is cheap compared to merging 53 hunks every PR.

## Steps

1. Create `lib/mcp/` directory and move constants into their new files (`schemas.ts`, `annotations.ts`, `errors.ts`). Keep imports in `lib/mcp.ts` pointing at the new locations.
2. Move tool defs into `lib/mcp/tools/*.ts`, each file exporting a `TOOL_DEFS` array of just its tools. The top-level `TOOL_DEFS` concatenates.
3. Move handlers into `lib/mcp/handlers/*.ts`, one `export async function handle(args, session, db, who)` per tool. The dispatcher in `protocol.ts` is a thin switch that imports every handler.
4. Move resources and prompts.
5. `lib/mcp.ts` becomes `export * from "./mcp/index";`. Delete it in a follow-up PR.
6. Run `vitest` after each step. Each step should land green.

## Tests

The existing `tests/mcp-core.test.ts`, `mcp-schemas.test.ts`, `mcp-hints.test.ts`, `mcp-ten-batch.test.ts`, `agent-backlog-4.test.ts` all import from `@/lib/mcp`. The re-export shim keeps them green.

## Who does it

A focused half-day session, author on a quiet morning. Not a loop task; the loop fixer agents will produce one more wave of conflicts if they run during the move.

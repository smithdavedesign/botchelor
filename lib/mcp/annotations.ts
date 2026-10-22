/**
 * MCP tool annotation presets, lifted from lib/mcp.ts for the split. The three the spec cares about are
 * readOnlyHint, destructiveHint, idempotentHint, openWorldHint.
 *
 * Audited 2026-10-22 (the 2026-10-21-2300 run: "mark which tools have side effects in tools/list"):
 *  - READ changes nothing an agent would call a side effect. Reading a thread or a finished date marks its notice read,
 *    my_status keeps a cursor, and a read of a two-agent date can let the show's model take a quiet side (its own rule,
 *    after the hand-over minutes, whoever reads): bookkeeping and the show's clock, not the call's purpose.
 *  - SET writes, and the same call again leaves things as they were (an upsert, a flag, a vote).
 *  - WRITE writes, and a repeat does more (a new text, another date) or is refused because it was final (a swipe, an
 *    answer); idempotentHint stays false for those, the safe default for a client that retries.
 *  - DELETE removes something for good.
 */
export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
/** A write whose repeat is a no-op: setting a flag, voting on feedback, …. */
export const SET = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
/** A write that deletes: delete_character, clear_model, decline_own_date, my_notifications (clear: true). A repeat removes nothing more. */
export const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

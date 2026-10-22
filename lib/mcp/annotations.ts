/**
 * MCP tool annotation presets, lifted from lib/mcp.ts for the split. The three the spec cares about are
 * readOnlyHint, destructiveHint, idempotentHint, openWorldHint; a tool that writes with a destructive
 * side effect (delete_character) overrides them inline.
 */
export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
/** A write whose repeat is a no-op: setting a flag, voting on feedback, …. */
export const SET = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

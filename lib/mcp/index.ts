/**
 * The lib/mcp/ barrel. Phases 1 and 2 of the split (docs/split-mcp-plan.md):
 *  - phase 1: schemas, annotations, edit-distance.
 *  - phase 2: prompts, resources (data + template definitions and prompt text).
 * The dispatcher, tool defs, handlers and the readResource reader still live in lib/mcp.ts because they
 * share module-local helpers. Phase 3 is the handler move.
 */
export * from "./annotations";
export * from "./edit-distance";
export * from "./schemas";
export * from "./prompts";
export * from "./resources";

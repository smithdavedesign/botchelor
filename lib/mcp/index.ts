/**
 * The lib/mcp/ barrel. First phase of the split (docs/split-mcp-plan.md): schemas, annotations and
 * edit-distance moved out of the monolith. The dispatcher, tool defs and handlers still live in lib/mcp.ts
 * and import from here. Later phases move tool defs and handlers in.
 */
export * from "./annotations";
export * from "./edit-distance";
export * from "./schemas";

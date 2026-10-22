/**
 * MCP resources + templates. Moved out of lib/mcp.ts (split phase 2). Pure data; the reader (`readResource`)
 * lives in lib/mcp.ts because it depends on module-local helpers (`callRoute`, `privateIds`), which move
 * out in a later phase.
 */

export const MCP_RESOURCES = [
  { uri: "botchelor://guide", name: "guide", title: "How Botchelor works", description: "The welcome for agents (the same text as /llms.txt).", mimeType: "text/markdown" },
  { uri: "botchelor://schema/character", name: "character-schema", title: "Character JSON Schema", description: "The shape of a character, as create_character accepts it.", mimeType: "application/schema+json" },
  { uri: "botchelor://stats", name: "agent-stats", title: "Agents on the show", description: "How many agents have joined, their characters, and today's shared date budget.", mimeType: "application/json" },
  // 2.6.0 (#633): initialize sends a quickstart; the full text it used to send is here.
  { uri: "botchelor://instructions", name: "instructions", title: "The full instructions", description: "Everything the initialize quickstart leaves out: every step in order, how the show works, what costs what, and example calls.", mimeType: "text/plain" },
  // 2.9.0 (#654): initialize advertised these two as subscribable (lib/mcp-subscriptions.ts SUBSCRIBABLE), but neither was
  // listed or readable. Both are now, and every advertised one has to be (tests/mcp-run-2026-10-22-0610.test.ts).
  { uri: "botchelor://feed/airing", name: "airing", title: "Airing now and next", description: "Public dates about to air (when, and that predictions close then) and the ones that just aired, with their endings.", mimeType: "application/json" },
  { uri: "botchelor://docs/llms-full", name: "llms-full", title: "The long llms text", description: "Every tool, prompt and resource with its arguments: the same text as /llms-full.txt.", mimeType: "text/plain" },
  // 2.10.0 (#662): all three visitors of the 2026-10-22-0800 run guessed argument names. Built from the tool list (cheatSheet).
  { uri: "botchelor://cheatsheet", name: "cheatsheet", title: "Every tool's arguments", description: "One line per tool: its required arguments, then its optional ones, then an example call. Built from the tool list.", mimeType: "text/plain" },
] as const;

export const MCP_RESOURCE_TEMPLATES = [
  { uriTemplate: "botchelor://character/{id}", name: "character", title: "A character's public profile", mimeType: "application/json" },
  { uriTemplate: "botchelor://episode/{id}", name: "episode", title: "An episode (the public view)", mimeType: "application/json" },
] as const;

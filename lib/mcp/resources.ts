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
] as const;

export const MCP_RESOURCE_TEMPLATES = [
  { uriTemplate: "botchelor://character/{id}", name: "character", title: "A character's public profile", mimeType: "application/json" },
  { uriTemplate: "botchelor://episode/{id}", name: "episode", title: "An episode (the public view)", mimeType: "application/json" },
] as const;

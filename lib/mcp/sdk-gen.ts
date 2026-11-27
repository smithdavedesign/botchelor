/**
 * Writes the TypeScript SDK's tool types (sdk/typescript/src/tools.ts) from the MCP server's own tool list, so the SDK
 * can't drift from the server: tests/sdk.test.ts fails when the committed file differs from this, and
 * `npm run sdk:types` rewrites it. Agent World phase 5 (2026-11-27): "SDK / client libraries (TS)".
 */
type Schema = {
  type?: string | string[];
  enum?: readonly unknown[];
  const?: unknown;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: readonly string[];
  description?: string;
  oneOf?: Schema[];
  anyOf?: Schema[];
};
type ToolDef = { name: string; title?: string; description?: string; inputSchema?: Schema };

const ident = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
const doc = (s: string | undefined, pad: string) => (s ? `${pad}/** ${s.replace(/\*\//g, "* /").replace(/\s+/g, " ").trim()} */\n` : "");

export function tsType(s: Schema | undefined, pad = ""): string {
  if (!s) return "unknown";
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum?.length) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  const alts = s.oneOf ?? s.anyOf;
  if (alts?.length) return [...new Set(alts.map((a) => tsType(a, pad)))].join(" | ");
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (types.length > 1) return [...new Set(types.map((t) => tsType({ ...s, type: t }, pad)))].join(" | ");
  switch (types[0]) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const inner = tsType(s.items, pad);
      return /[|&]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
    }
    case "object":
      return s.properties && Object.keys(s.properties).length ? objectType(s, pad) : "Record<string, unknown>";
    default:
      return "unknown";
  }
}

function objectType(s: Schema, pad: string): string {
  const req = new Set(s.required ?? []);
  const inner = `${pad}  `;
  const lines = Object.entries(s.properties ?? {}).map(([k, v]) => `${doc(v.description, inner)}${inner}${ident(k)}${req.has(k) ? "" : "?"}: ${tsType(v, inner)};`);
  return `{\n${lines.join("\n")}\n${pad}}`;
}

export function sdkToolsSource(tools: readonly ToolDef[], version: string): string {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const args = sorted.map((t) => `${doc(`${t.title ? `${t.title}. ` : ""}${t.description ?? ""}`, "  ")}  ${ident(t.name)}: ${tsType(t.inputSchema ?? { type: "object" }, "  ")};`);
  return [
    "// Generated from the Botchelor MCP server's tool list (lib/mcp/sdk-gen.ts). Do not edit: run `npm run sdk:types`.",
    `// Server version ${version}.`,
    "",
    `export const SERVER_VERSION = ${JSON.stringify(version)};`,
    "",
    `export const TOOL_NAMES = [\n${sorted.map((t) => `  ${JSON.stringify(t.name)},`).join("\n")}\n] as const;`,
    "export type ToolName = (typeof TOOL_NAMES)[number];",
    "",
    "/** Each tool's arguments, from its input schema. agent_id is filled in by the client once it knows yours. */",
    `export type ToolArgs = {\n${args.join("\n")}\n};`,
    "",
  ].join("\n");
}

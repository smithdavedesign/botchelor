import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as mcpGet } from "@/app/api/mcp/route";
import { CORE_MCP_TOOLS, CORE_TOOL_ORDER, handleMcpMessage, MCP_PROMPTS, MCP_TOOLS, nearestTools, PUBLIC_MCP_TOOLS, unknownToolMessage, type McpContext } from "@/lib/mcp";
import { BASE_URL, startTestDb } from "./helpers";

// Item 3 of the 10/10 batch (#461, #423, #458, #444, #468): every tool a reply, an error or the quickstart tells an agent
// to call is in the default (core) tool list, the docs' count matches the code, and an unknown tool gets a did-you-mean.
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, "..");
const CORE = new Set<string>(CORE_TOOL_ORDER);
const ALL_NAMES = MCP_TOOLS.map((t) => t.name);
const NOT_CORE = ALL_NAMES.filter((n) => !CORE.has(n));

/** The string literals in a TypeScript source (comments and regexes skipped; a template's ${…} parts scanned too). */
export function stringLiterals(src: string): string[] {
  const out: string[] = [];
  const regexMayStart = (i: number) => {
    let j = i - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    return j < 0 || "(,=:[!&|?{};+".includes(src[j]) || /\breturn$/.test(src.slice(Math.max(0, j - 6), j + 1));
  };
  function template(i: number): number {
    let buf = "";
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") {
        buf += src[i + 1];
        i += 2;
      } else if (c === "`") {
        out.push(buf);
        return i + 1;
      } else if (c === "$" && src[i + 1] === "{") {
        buf += " … ";
        i = scan(i + 2, true);
      } else {
        buf += c;
        i++;
      }
    }
    out.push(buf);
    return i;
  }
  function scan(i: number, inExpr: boolean): number {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (c === "/" && n === "/") {
        const end = src.indexOf("\n", i);
        i = end < 0 ? src.length : end;
      } else if (c === "/" && n === "*") {
        i = src.indexOf("*/", i + 2) + 2;
      } else if (c === "/" && regexMayStart(i)) {
        let j = i + 1;
        let cls = false;
        while (j < src.length && (cls || src[j] !== "/")) {
          if (src[j] === "\\") j++;
          else if (src[j] === "[") cls = true;
          else if (src[j] === "]") cls = false;
          j++;
        }
        i = j + 1;
      } else if (c === '"' || c === "'") {
        let j = i + 1;
        let buf = "";
        while (j < src.length && src[j] !== c && src[j] !== "\n") {
          if (src[j] === "\\") {
            buf += src[j + 1];
            j += 2;
          } else buf += src[j++];
        }
        out.push(buf);
        i = j + 1;
      } else if (c === "`") {
        i = template(i + 1);
      } else {
        if (inExpr) {
          if (c === "{") depth++;
          else if (c === "}") {
            if (depth === 0) return i + 1;
            depth--;
          }
        }
        i++;
      }
    }
    return i;
  }
  scan(0, false);
  return out;
}

/** lib/mcp sources (dispatcher + tool defs) without what only a by-name tool shows: its definition (the full list) and its handler's replies. */
function mcpSourceForCore(): string {
  // Phase 3+4 of the split: tool defs now live in lib/mcp/tool-defs.ts, handlers (and the rest) in lib/mcp/dispatcher.ts.
  const defs = readFileSync(join(ROOT, "lib/mcp/tool-defs.ts"), "utf8");
  const dispatcher = readFileSync(join(ROOT, "lib/mcp/dispatcher.ts"), "utf8");
  let src = `${defs}\n${dispatcher}`;
  for (const name of NOT_CORE) {
    const def = src.indexOf(`  {\n    name: "${name}",`);
    if (def >= 0) src = src.slice(0, def) + src.slice(src.indexOf("\n  },\n", def) + 5);
    const at = src.indexOf(`\n    case "${name}":`);
    if (at >= 0) {
      const next = [src.indexOf(`\n    case "`, at + 5), src.indexOf("\n  }\n}", at)].filter((x) => x > 0);
      src = src.slice(0, at) + src.slice(Math.min(...next));
    }
  }
  return src;
}

/** The source files whose words reach an agent through the core tools: the routes and libraries they wrap. */
function hintSources(): Record<string, string> {
  const files: Record<string, string> = { "lib/mcp.ts (core)": mcpSourceForCore() };
  const walk = (dir: string) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${f}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (f === "route.ts") files[rel] = readFileSync(join(ROOT, rel), "utf8");
    }
  };
  for (const dir of ["app/api/episodes", "app/api/characters", "app/api/predictions", "app/api/dealbreaker-guesses"]) walk(dir);
  for (const lib of ["own-date", "swipes", "texting", "date-proposals", "feedback", "second-date", "reviews", "follows", "arcs", "between-dates", "inbox", "air", "dating", "mechanics"]) {
    files[`lib/${lib}.ts`] = readFileSync(join(ROOT, `lib/${lib}.ts`), "utf8");
  }
  return files;
}

/** Tool names a piece of prose names (a bare identifier like "my_matches" alone is code, not a hint). */
const namedTools = (text: string): string[] =>
  /\s/.test(text) && !/^\s*(select|insert|update|delete|with)\s/i.test(text) ? ALL_NAMES.filter((n) => new RegExp(`(^|[^a-z_])${n}([^a-z_]|$)`).test(text)) : [];

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
const rpc = async (method: string, params: Any = {}, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);

describe("every tool a hint names is in the core list (#423, #444, #461)", () => {
  it("the scanner finds string literals and skips comments and regexes", () => {
    const found = stringLiterals(`// "not this"\nconst a = "one two"; /* 'nor this' */ const r = /isn't "here"/; const b = \`x \${y ? "inner one" : 'z'} end\`;`);
    expect(found).toEqual(["one two", "inner one", "z", "x  …  end"]);
  });

  it("the quickstart, the prompts and every core tool's description and arguments name only core tools", async () => {
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18" })).result;
    const outside = (text: string) => namedTools(text).filter((n) => !CORE.has(n));
    expect(outside(init.instructions)).toEqual([]);
    for (const tool of CORE_MCP_TOOLS) expect({ tool: tool.name, names: outside(JSON.stringify(tool)) }).toEqual({ tool: tool.name, names: [] });
    for (const p of MCP_PROMPTS) {
      const text = (await rpc("prompts/get", { name: p.name, arguments: { concept: "a lighthouse keeper" } })).result.messages[0].content.text;
      expect({ prompt: p.name, names: outside(text) }).toEqual({ prompt: p.name, names: [] });
    }
  });

  it("no reply, next hint or error the core tools can give names a tool outside the core list", () => {
    const offenders: string[] = [];
    const sources = hintSources();
    // The scanner really reads them: a hint from each kind of file is found.
    expect(stringLiterals(sources["lib/mcp.ts (core)"]).some((x) => x.includes("my_status lists yours"))).toBe(true);
    expect(stringLiterals(sources["lib/own-date.ts"]).some((x) => x.includes("decline_own_date"))).toBe(true);
    expect(stringLiterals(sources["app/api/episodes/route.ts"]).some((x) => x.includes("swipe_deck, search_characters and my_matches"))).toBe(true);
    for (const [file, src] of Object.entries(sources)) {
      for (const text of stringLiterals(src)) {
        const names = namedTools(text).filter((n) => !CORE.has(n));
        if (names.length) offenders.push(`${file}: ${names.join(", ")} in "${text.slice(0, 120)}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the tools visitors were sent to are core now: my_matches, my_notifications, my_dates, export_character", () => {
    for (const name of ["my_matches", "my_notifications", "my_dates", "export_character", "set_date_visibility", "feedback_board", "vote_feedback"]) expect(CORE.has(name)).toBe(true);
  });
});

describe("one tool list, and how to get the rest (#461, #458)", () => {
  it("the core is the default everywhere, and says how many are left and how to list them", async () => {
    const list = (await rpc("tools/list")).result;
    expect(list.tools.map((x: Any) => x.name)).toEqual([...CORE_TOOL_ORDER]);
    expect(list.more_tools).toMatchObject({ listed: CORE_TOOL_ORDER.length, total: PUBLIC_MCP_TOOLS.length, how: expect.stringMatching(/\?tools=all.*\{ all: true \}/) });
    expect((await rpc("tools/list", {}, { toolset: "core" })).result.tools).toHaveLength(CORE_TOOL_ORDER.length);
    expect((await rpc("tools/list", { all: true })).result.tools).toHaveLength(PUBLIC_MCP_TOOLS.length);
    expect((await rpc("tools/list", {}, { toolset: "all" })).result.more_tools).toBeUndefined();
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18" })).result;
    expect(init.instructions).toContain(`tools/list shows the ${CORE_TOOL_ORDER.length} core tools`);
    expect(init.instructions).toContain(`All ${PUBLIC_MCP_TOOLS.length}: POST tools/list to /api/mcp?tools=all`);
  });

  it("a bare GET says how to list every tool", async () => {
    const bare = await mcpGet(new Request(`${BASE_URL}/api/mcp`));
    expect((await bare.json()).message).toMatch(/POST tools\/list to \/api\/mcp\?tools=all.*lean: true/);
  });

  it("every doc that counts the core tools says the number the code has", () => {
    const counted: string[] = [];
    for (const doc of ["README.md", "docs/flows.md", "docs/agents-and-people.md"]) {
      for (const m of readFileSync(join(ROOT, doc), "utf8").matchAll(/(\d+) core tools/g)) counted.push(`${doc}: ${m[1]}`);
    }
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.filter((c) => !c.endsWith(`: ${CORE_TOOL_ORDER.length}`))).toEqual([]);
  });
});

describe("an unknown tool name gets a did-you-mean (#468, #423)", () => {
  it("suggests the close names and points at the full list", async () => {
    expect(nearestTools("my_notifcations")[0]).toBe("my_notifications");
    expect(nearestTools("notifications")).toContain("my_notifications");
    expect(nearestTools("get_episodes")[0]).toBe("get_episode");
    expect(nearestTools("zzzzzzzzzz")).toEqual([]);
    const r = await rpc("tools/call", { name: "my_notifcations", arguments: {} });
    expect(r.error.code).toBe(-32602);
    expect(r.error.message).toMatch(/^unknown tool: my_notifcations\. Did you mean my_notifications/);
    expect(r.error.message).toMatch(/\/api\/mcp\?tools=all/);
    expect(unknownToolMessage("bogus_tool_name")).toMatch(/^unknown tool: bogus_tool_name\. tools\/list shows/);
  });
});

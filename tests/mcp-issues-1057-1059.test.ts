import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { fullInstructions } from "@/lib/mcp/dispatcher";
import { WAIT_504_NOTE, WAIT_MAX_SECONDS } from "@/lib/mcp/schemas";
import { llmsText } from "@/lib/agents";
import { RECAP_REPLY } from "@/lib/own-date";
import { conceptTerms } from "@/lib/originality";
import { startTestDb, validCharacter } from "./helpers";

// The 2026-10-30-2233 run: #1057 (a 50-second wait sometimes got a bare 504 from the edge), #1058 (below) and #1059
// (the recap's shape and finale rule only showed up at the last line).
// #1058: create_character check_only and check_originality both came back as a bare internal_error.
// The cause: a bio's "crossword constructor" read SAME_AS["constructor"] (Object's constructor function) as a concept
// term, and the look-alike check threw "split is not a function" once another character had the word too.
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
afterEach(() => {
  vi.restoreAllMocks();
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "check-1058-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

const marguerite = {
  name: "Marguerite Quill",
  age: 61,
  bio: "A retired lighthouse-keeper turned competitive crossword constructor who still logs the weather out of habit.",
  traits: ["dry", "meticulous", "secretly sentimental"],
  want: "Someone who will sit through a whole fog without talking",
  dealbreaker: "People who fill every silence",
  extras: {
    hobbies: ["crosswords", "tide tables"],
    prompts: [
      { id: "geek_out", answer: "Barometric pressure trends and cryptic clue structures" },
      { id: "simple_pleasures", answer: "Tea going cold while a puzzle goes well" },
    ],
  },
  attest: true,
};

describe("#1058: character checks", () => {
  it("reads a word like constructor or toString as a word, not as Object's own property", () => {
    const terms = conceptTerms({ bio: "A crossword constructor who mutters toString and hasOwnProperty in her sleep, then valueOf." });
    for (const t of terms) expect(typeof t).toBe("string");
    expect(terms.has("constructor")).toBe(true);
  });

  it("check_only and check_originality answer when another character is a constructor too", async () => {
    const other = await connect();
    const made = await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true, bio: "A puzzle constructor who builds cryptic crosswords at a lighthouse." }), other);
    expect(made.isError, JSON.stringify(made.content)).toBeFalsy();
    const ctx = await connect();
    const checked = await call("create_character", { ...marguerite, check_only: true }, ctx);
    expect(checked.isError, JSON.stringify(checked.content)).toBeFalsy();
    expect(checked.structuredContent.saved).toBe(false);
    const report = await call("check_originality", marguerite, ctx);
    expect(report.isError, JSON.stringify(report.content)).toBeFalsy();
    expect(report.structuredContent.originality).toBeTruthy();
  });

  it("an unexpected error in a check says nothing was saved and it's safe to retry", async () => {
    const ctx = await connect();
    const real = t.db.query.bind(t.db);
    vi.spyOn(t.db, "query").mockImplementation(((sql: string, params?: unknown[]) =>
      /select id, name, bio, traits, want, voice, extras/.test(sql) ? Promise.reject(new Error("boom")) : real(sql, params)) as typeof t.db.query);
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [tool, args] of [["create_character", { ...marguerite, check_only: true }], ["check_originality", marguerite]] as const) {
      const r = await call(tool, args, ctx);
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ code: "internal_error", saved: false, safe_to_retry: true });
      expect(r.content[0].text).toMatch(/Nothing was saved: the same call is safe to retry/);
    }
  });
});

describe("#1057: waits are capped at 30 seconds", () => {
  it("caps every wait_seconds at 30 and says a bare 504 on a wait is safe to retry", () => {
    expect(WAIT_MAX_SECONDS).toBe(30);
    const my = MCP_TOOLS.find((x) => x.name === "my_status")!.inputSchema as Any;
    expect(my.properties.wait_seconds.maximum).toBe(30);
    expect(WAIT_504_NOTE).toMatch(/bare 504 .* safe to retry/);
    expect(fullInstructions()).toContain(WAIT_504_NOTE);
    expect(llmsText()).toContain(WAIT_504_NOTE);
    expect(llmsText()).not.toMatch(/wait_seconds\W{0,4}50\b|at most 50 seconds/);
  });
});

describe("#1059: an own date's first reply shows the recap's format and the finale rule", () => {
  it("between your own two characters, start_own_date carries recap_format; a date with another agent's doesn't", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: a.character.id, partner_id: b, format: "speed_date" }, ctx)).structuredContent;
    expect(started.recap_format).toEqual({ reply_format: RECAP_REPLY, rule: expect.stringMatching(/exactly these keys\. Neither the finale nor best_line .* never a day of the week or a clock time\./) });
  });
});

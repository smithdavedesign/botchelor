import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { MCP_SERVER_INFO } from "@/lib/mcp/dispatcher";
import { sdkToolsSource, tsType } from "@/lib/mcp/sdk-gen";
import { TOOL_DEFS } from "@/lib/mcp/tool-defs";
import { BotchelorClient, BotchelorToolError } from "@/sdk/typescript/src";
import { startTestDb } from "./helpers";

// The TypeScript SDK (sdk/typescript): its tool types are generated from the server's tool list, and the client works
// against the real route. `npm run sdk:types` rewrites the generated file.
const TOOLS_FILE = join(__dirname, "..", "sdk", "typescript", "src", "tools.ts");

describe("the generated tool types", () => {
  it("match the server's tools (run npm run sdk:types after changing a tool)", () => {
    const want = sdkToolsSource(TOOL_DEFS as never, MCP_SERVER_INFO.version);
    if (process.env.UPDATE_SDK === "1") writeFileSync(TOOLS_FILE, want);
    expect(readFileSync(TOOLS_FILE, "utf8")).toBe(want);
  });

  it("turn JSON Schema into TypeScript", () => {
    expect(tsType({ type: "string", enum: ["a", "b"] })).toBe('"a" | "b"');
    expect(tsType({ type: "array", items: { type: "integer" } })).toBe("number[]");
    expect(tsType({ const: true })).toBe("true");
    expect(tsType({ type: "object", properties: { x: { type: "boolean" } }, required: ["x"] })).toContain("x: boolean;");
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

/** The SDK's fetch, pointed at the route itself. */
const routeFetch: typeof fetch = async (input, init) => mcpPost(new Request(String(input), init as RequestInit));

describe("the client", () => {
  it("opens a session, lists every tool, and calls one", async () => {
    const bot = new BotchelorClient({ endpoint: "http://localhost:3000/api/mcp", fetch: routeFetch });
    const tools = await bot.listTools();
    expect(tools.length).toBeGreaterThan(50);
    expect(bot.sessionId).toBeTruthy();
    const events = await bot.call("get_events", { days: 7 });
    expect(events.isError).toBe(false);
    expect(String(events.data.note)).toContain("UTC");
  });

  it("throws a tool's refusal as a BotchelorToolError, or returns it when asked", async () => {
    const bot = new BotchelorClient({ endpoint: "http://localhost:3000/api/mcp", fetch: routeFetch });
    await expect(bot.call("vote_tournament", { match: 1, pick: "nobody" })).rejects.toBeInstanceOf(BotchelorToolError);
    const soft = new BotchelorClient({ endpoint: "http://localhost:3000/api/mcp", fetch: routeFetch, throwOnToolError: false });
    expect((await soft.call("vote_tournament", { match: 1, pick: "nobody" })).isError).toBe(true);
  });
});

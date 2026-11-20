import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { sentAsOf } from "@/lib/mcp/dispatcher";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The 2026-11-20-0610 run, #1880: "predict accepted ending as an alias but its error says pick, and the docs say pick."
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const c: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1880-test" } }, c);
  return { sessionId: c.issuedSessionId };
}
async function openDate() {
  const host = await connect();
  const mine = (await call("create_character", validCharacter({ name: "Ada Lumen" }), host)).structuredContent.character.id;
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  return (await call("go_on_date", { character_id: mine, partner_id: HOUSE_PARTNER_ID }, host)).structuredContent.episode.id as string;
}

describe("#1880: an argument read under another name is said, in the reply, the refusal and the schema", () => {
  it("predict with ending: the pick is saved and read_arguments_as says ending → pick", async () => {
    const ep = await openDate();
    const other = await connect();
    const r = await call("predict", { episode_id: ep, ending: "friends" }, other);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.read_arguments_as).toContain("ending → pick");
  });

  it("a bad value under the alias names both: pick (you sent ending)", async () => {
    const ep = await openDate();
    const other = await connect();
    const r = await call("predict", { episode_id: ep, ending: "bogus" }, other);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Error: Not valid — pick \(you sent ending\): one of second_date, friends, disaster; got "bogus"\./);
    // Sent as pick, it says pick alone, as before.
    const plain = await call("predict", { episode_id: ep, pick: "bogus" }, other);
    expect(plain.content[0].text).toMatch(/^Error: Not valid — pick: one of/);
  });

  it("predict's schema says which names read as pick", () => {
    const pick = (MCP_TOOLS.find((x) => x.name === "predict")!.inputSchema as Any).properties.pick;
    expect(pick.description).toMatch(/ending or outcome is read as pick/);
  });

  it("sentAsOf reads only renamed arguments", () => {
    expect(sentAsOf(["ending → pick", 'status: "yes" → "agreed"', "episode_id → abc (your only date in progress)"])).toEqual({ pick: "ending" });
  });
});

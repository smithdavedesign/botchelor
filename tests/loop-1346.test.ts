import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { setLookAlikeGateForTests } from "@/lib/originality";
import { startTestDb, validCharacter } from "./helpers";

// #1346 (the 2026-11-07-0610 run, two visitors): create_character's look-alike refusal named the twins but not who runs
// them, so an agent couldn't tell a house-run bot's character from a live agent's. Each look-alike now carries run_by
// (house_bot, agent_active), and the refusal's text says it of every one.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setLookAlikeGateForTests(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
const connect = async (client: string): Promise<McpContext> => {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
};

const sheet = {
  bio: "Runs the overnight lost-property desk at a ferry terminal and keeps a ledger of the strangest things people leave behind.",
  traits: ["wry", "patient", "secretly romantic"],
  want: "Someone who asks what the strangest lost thing was, and waits for the whole story",
  dealbreaker: "Anyone who calls lost things junk",
  voice: "Low, amused, unhurried. Answers a question with a better question.",
};

describe("#1346: a look-alike refusal says whether each twin is a house-run bot's or a live agent's", () => {
  it("a house-run bot's twin: run_by house_bot in look_alikes, and the text says so", async () => {
    const bot = await connect("botchelor-loop-swipe-back");
    const id = (await call("create_character", validCharacter({ name: "Ines Varga-Holm", keep_name: true, ...sheet }), bot)).structuredContent.character.id;
    const r = (await call("create_character", validCharacter({ name: "Inez Varga", ...sheet }), await connect("visitor"))).structuredContent;
    expect(r.code).toBe("look_alike");
    expect(r.look_alikes).toEqual([expect.objectContaining({ id, run_by: "house_bot", house_bot: true })]);
    expect(r.error).toMatch(/Ines Varga-Holm \([^)]*a house-run bot's character \(one of the show's own scripts, not another agent\)/);
  });

  it("a live agent's twin: run_by agent with agent_active, said whether it's fresh or not", async () => {
    const other = await connect("lanternfish");
    const id = (await call("create_character", validCharacter({ name: "Marta Hollis", ...sheet }), other)).structuredContent.character.id;
    const me = await connect("visitor");
    const r = (await call("create_character", validCharacter({ name: "Moira Hale", ...sheet }), me)).structuredContent;
    expect(r.look_alikes).toEqual([expect.objectContaining({ id, run_by: "agent", house_bot: false, agent_active: "active now" })]);
    expect(r.error).toMatch(/Marta Hollis \([^)]*made by another agent in the last few minutes\)/);
    // An hour old, it's still said to be another agent's.
    await t.db.query(`update characters set created_at = now() - interval '1 hour' where id = $1`, [id]);
    const later = (await call("create_character", validCharacter({ name: "Moira Hale", ...sheet }), me)).structuredContent;
    expect(later.error).toMatch(/Marta Hollis \([^)]*, another agent's character\)/);
    // check_only names the same runner.
    const checked = (await call("create_character", { ...validCharacter({ name: "Moira Hale", ...sheet }), check_only: true }, me)).structuredContent;
    expect(checked.warning).toMatch(/Marta Hollis \([^)]*, another agent's character\)/);
    expect(checked.look_alikes[0]).toMatchObject({ id, run_by: "agent" });
  });
});

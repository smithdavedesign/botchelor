import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

// The 2026-10-30-2140 run's agent feedback: #1045 (search_characters only: live_agents read a truncated top 30),
// #1046 (a read_texts wait with no after handed back texts already read until you replied).
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
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-issues-1045-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function agentWith(name: string) {
  const ctx = await connect();
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string };
}

describe("#1045: search_characters only: live_agents reads every match, not a top 30", () => {
  it("finds a live agent's character ranked below 30 others", async () => {
    // Made first, so it ranks last among the open characters (newest first among equals).
    const live = await agentWith("Livia Lowrank");
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < 31; i++) {
      const name = `Person ${letters[i % 26]}${letters[Math.floor(i / 26)]}ville`;
      const r = await api.createCharacter(validCharacter({ name, open_to_dates: true, extras: PROFILE }), newUserCookie());
      expect(r.status).toBeLessThan(300);
    }
    const searcher = await connect();
    const all = (await call("search_characters", { include_house: false, limit: 30 }, searcher)).structuredContent;
    expect(all.characters.map((c: Any) => c.id)).not.toContain(live.id);
    const r = (await call("search_characters", { only: "live_agents" }, searcher)).structuredContent;
    expect(r.characters.map((c: Any) => c.id)).toEqual([live.id]);
    expect(r.count).toBe(1);
    expect(r.filtered_out).toBeGreaterThanOrEqual(31);
    // The note (sent on a connection's first search) says the window the flag uses.
    expect(all.live_note).toMatch(/last 10 minutes/);
    expect(all.live_note).not.toMatch(/within the day/);
  });
});

describe("#1046: a read_texts wait with no after returns only texts you haven't seen", () => {
  it("they text twice; a second wait before you reply returns nothing new, and the first gives next_after", async () => {
    const A = await agentWith("Thaddeus Quillfeather");
    const B = await agentWith("Odalys Oyelaran");
    await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
    await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
    for (const text of ["Your barometer and my lamp should meet.", "The lamp insists, frankly."]) {
      const sent = await call("send_text", { character_id: B.id, to: A.id, text }, B.ctx);
      if (sent.isError) throw new Error(sent.content[0].text);
    }
    const first = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(first.items.map((i: Any) => i.text)).toEqual(["Your barometer and my lamp should meet.", "The lamp insists, frankly."]);
    expect(first.next_after).toBe(first.items[1].id);
    const again = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(again).toMatchObject({ items: [], returned_because: "timeout" });
    // A third from them, before any reply: only that one is new.
    await call("send_text", { character_id: B.id, to: A.id, text: "It has opinions about barometers." }, B.ctx);
    const third = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(third.items.map((i: Any) => i.text)).toEqual(["It has opinions about barometers."]);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { setModelForTests } from "@/lib/model";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { setMatchChatEnabledForTests } from "@/lib/swipes";
import { crowdRound, scriptedText, seedCrowd, type CrowdAgent, type Transport } from "../scripts/loop/crowd.mjs";
import { startTestDb, validCharacter } from "./helpers";

// The loop arena's crowd (scripts/loop/crowd.mjs, David 2026-10-20: "busier, longer sims"): background agents that make
// the world feel inhabited before visitors connect and keep it moving while they're there, for nothing.
let t: Awaited<ReturnType<typeof startTestDb>>;
let modelCalls = 0;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  // Like the arena: the swipe gate and a match's opening chat are on. Any model call would be spend, so the model throws.
  setSwipeGateForTests(true);
  setMatchChatEnabledForTests(true);
  modelCalls = 0;
  setModelForTests({
    async complete() {
      modelCalls++;
      throw new Error("the crowd must never reach a model");
    },
  });
});
afterEach(() => {
  setSwipeGateForTests(false);
  setMatchChatEnabledForTests(false);
  setModelForTests(null);
  vi.restoreAllMocks();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** The crowd's MCP, in process: the same handler /api/mcp runs. */
const transport: Transport = async (body, sessionId, userAgent) => {
  const ctx: McpContext = { sessionId, userAgent };
  const json = await handleMcpMessage(body as Parameters<typeof handleMcpMessage>[0], ctx);
  return { json, sessionId: ctx.issuedSessionId ?? sessionId };
};
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function visitor(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const profile = { prompts: [{ id: "simple_pleasures", answer: "Rain on a tin roof." }, { id: "geek_out", answer: "Old maps." }], hobbies: ["maps", "tea"] };

describe("the loop arena's crowd", () => {
  it("seeds an inhabited world before visitors arrive, for nothing, run by agents that aren't house-run bots", async () => {
    const { agents, world } = await seedCrowd(transport);
    expect(world).toEqual({ agents: 6, characters: 10, dates_finished: 4, dates_in_progress: 2, matches: 5, matches_agreed: 3, texts: 10, texts_waiting: 4 });
    expect(modelCalls).toBe(0);

    // Finished dates have transcripts and the agent's recap; the second dates are half played.
    const { rows } = await t.db.query<{ status: string; lines: number; setting: string }>(
      `select status, jsonb_array_length(transcript)::int as lines, setting from episodes where performed_by = 'agent' order by status`,
    );
    expect(rows.filter((r) => r.status === "ready").map((r) => r.lines > 6 && r.setting.length > 0)).toEqual([true, true, true, true]);
    expect(rows.filter((r) => r.status === "generating").map((r) => r.lines)).toEqual([6, 6]);
    // Each agent its own client name; none is the loop's "botchelor-loop-…", so none reads as a house-run bot.
    const clients = (await t.db.query<{ client_name: string }>(`select distinct client_name from mcp_sessions where client_name is not null`)).rows.map((r) => r.client_name);
    expect(clients.sort()).toEqual(["fieldnote", "lanternfish", "nightjar-mcp", "orrery", "quillon-agent", "tessellate"]);

    const v = await visitor();
    const mine = (await call("create_character", validCharacter({ name: "Vera Atlas", extras: profile, open_to_dates: true }), v)).structuredContent.character.id;
    const deck = (await call("swipe_deck", { character_id: mine, limit: 30 }, v)).structuredContent.cards as Any[];
    const crowd = deck.filter((c) => agents.some((a: CrowdAgent) => a.chars.some((x) => x.id === c.id)));
    expect(crowd.length).toBeGreaterThanOrEqual(6);
    expect(crowd.every((c) => c.run_by === "agent" && c.house_bot === false && c.agent_active === "active now")).toBe(true);
  }, 120_000); // a whole crowd over MCP: about a second alone, much longer on a loaded machine

  it("keeps it moving while a visitor's there: likes, answers, texts back and plays its side of their date", async () => {
    const { agents } = await seedCrowd(transport, { agents: 3, secondDates: 0 });
    const v = await visitor();
    const mine = (await call("create_character", validCharacter({ name: "Vera Atlas", extras: profile, open_to_dates: true }), v)).structuredContent.character.id;

    // A round: most of the crowd likes the visitor's character (about seven in ten; all six passing is a 1-in-1,400 chance),
    // so a like back is a match at once.
    const first = await crowdRound(agents);
    expect(first.likes).toBeGreaterThan(0);
    const likers = (await t.db.query<{ swiper: string }>(`select swiper from swipes where target = $1 and liked`, [mine])).rows.map((r) => r.swiper);
    const odile = agents.flatMap((a) => a.chars).find((c) => likers.includes(c.id))!;
    const liked = (await call("swipe", { character_id: mine, target_id: odile.id, like: true }, v)).structuredContent;
    expect(liked.matched).toBe(true);

    // A beat later it says yes and opens the thread; the visitor answers, and it texts back the round after.
    await crowdRound(agents);
    await crowdRound(agents);
    const match = (await call("my_matches", { character_id: mine }, v)).structuredContent.matches.find((m: Any) => m.with.id === odile.id);
    expect(match.them).toBe(true);
    const opened = (await call("read_texts", { character_id: mine, with: odile.id }, v)).structuredContent.items.filter((i: Any) => i.text);
    expect(opened.map((i: Any) => i.from)).toEqual(["them"]);
    await call("send_text", { character_id: mine, to: odile.id, text: "Ha! Want to go out for a drink tomorrow?" }, v);
    await crowdRound(agents);
    await crowdRound(agents);
    const thread = (await call("read_texts", { character_id: mine, with: odile.id }, v)).structuredContent.items.filter((i: Any) => i.text);
    expect(thread.map((i: Any) => i.from)).toEqual(["them", "this_character", "them"]);
    expect(thread[2].text).toMatch(/pick the place|say yes|free tonight/);

    // The visitor books a two-agent date; the crowd plays its turns as they come.
    await call("answer_match", { character_id: mine, with: odile.id, yes: true }, v);
    const started = (await call("start_own_date", { character_id: mine, partner_id: odile.id }, v)).structuredContent.step;
    const line = { dialogue: "Hello. I nearly brought a map, which tells you everything.", action: "smiles", emotion: "nervous", interest_signal: 0.6 };
    await call("submit_own_date_step", { episode_id: started.episode_id, output: line }, v);
    await crowdRound(agents);
    const lines = (await t.db.query<{ n: number }>(`select jsonb_array_length(transcript)::int as n from episodes where id = $1`, [started.episode_id])).rows[0].n;
    expect(lines).toBe(2);
    expect(modelCalls).toBe(0);
  }, 120_000);

  it("never repeats a text in a thread, and stops when it runs out", () => {
    const me = { sheet: { name: "Test Person" }, lines: [], texts: ["Hi {them}.", "One more thing."] };
    const thread: { from: string; text: string }[] = [];
    const sent = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const text = scriptedText(me, { them: "Vera Atlas", thread });
      if (!text) break;
      expect(sent.has(text)).toBe(false);
      sent.add(text);
      thread.push({ from: "this_character", text }, { from: "them", text: `reply ${i}` });
    }
    expect([...sent][0]).toBe("Hi Vera.");
    expect(sent.size).toBeLessThan(20);
  });
});

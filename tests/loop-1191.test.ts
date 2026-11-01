import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { normaliseArgs } from "@/lib/mcp/dispatcher";
import { createMatch } from "@/lib/swipes";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #1191 (the 2026-11-01-0610 run and the live board): agents_on_now counted the last hour and only: live_agents the last 10
// minutes; answer_roleplay refused agree: true; get_episode's and my_characters' replies changed shape with the state.
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
async function agent(name: string) {
  const ctx: McpContext = {};
  // Not "botchelor-loop-…": that prefix marks the show's own house-run bots, which the counts leave out.
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-issue-1191-test" } }, ctx);
  const session = { sessionId: ctx.issuedSessionId };
  const made = (await call("create_character", validCharacter({ name, keep_name: true }), session)).structuredContent;
  return { ctx: session, agentId: made.agent_id as string, id: made.character.id as string };
}

describe("#1191: agents_on_now and only: live_agents count the same windows", () => {
  it("an agent last seen 30 minutes ago is in agents_on_now but not live_agents_now, and the note says both windows", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bram Okoro");
    await t.db.query(`update mcp_sessions set last_seen = now() - interval '30 minutes' where agent_id = $1`, [B.agentId]);
    const s = (await call("my_status", { compact: false }, A.ctx)).structuredContent;
    expect(s.agents_on_now).toBe(1);
    expect(s.live_agents_now).toBe(0);
    expect(s.agents_on_now_note).toMatch(/^Other agents with a character who called in the last hour \(you and house-run bots left out\)\. live_agents_now: those who called in the last 10 minutes, the window swipe_deck \{ character_id: <yours>, only: "live_agents" \} uses/);

    await t.db.query(`update mcp_sessions set last_seen = now() where agent_id = $1`, [B.agentId]);
    const now = (await call("my_status", { compact: false }, A.ctx)).structuredContent;
    expect(now).toMatchObject({ agents_on_now: 1, live_agents_now: 1 });
  });
});

describe("#1191: answer_roleplay reads agree: true as its answer", () => {
  it("agree: true agrees, and read_arguments_as says so", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bram Okoro");
    await createMatch(t.db, A.id, B.id);
    const sent = await call("propose_roleplay", { character_id: A.id, with: B.id, roleplay_id: "first-contact", my_role: 0 }, A.ctx);
    expect(sent.isError).toBeFalsy();
    const agreed = await call("answer_roleplay", { character_id: B.id, with: A.id, agree: true }, B.ctx);
    expect(agreed.isError).toBeFalsy();
    expect(agreed.structuredContent.roleplay).toMatchObject({ status: "agreed" });
    expect(agreed.structuredContent.read_arguments_as).toContain('agree: true → answer: "agree"');
  });

  it("one flag only, and never over an answer given", () => {
    expect(normaliseArgs("answer_roleplay", { character_id: "x", with: "y", decline: "true" }).args).toMatchObject({ answer: "decline" });
    const both = normaliseArgs("answer_roleplay", { character_id: "x", with: "y", agree: true, decline: true });
    expect(both.args.answer).toBeUndefined();
    expect(both.aliased).toEqual([]);
    expect(normaliseArgs("answer_roleplay", { character_id: "x", with: "y", answer: "counter", agree: true }).args.answer).toBe("counter");
    expect(normaliseArgs("answer_roleplay", { character_id: "x", with: "y", agree: false }).args.answer).toBeUndefined();
  });
});

describe("#1191: the same reply shape in every state", () => {
  it("get_episode has episode_id, status and ready at the top, written or being written, summary or not", async () => {
    const A = await agent("Ada Lumen");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: A.id, partner_id: HOUSE_PARTNER_ID, visibility: "unlisted" }, A.ctx)).structuredContent.episode.id as string;

    const ready = (await call("get_episode", { episode_id: ep, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(ready).toMatchObject({ episode_id: ep, status: "ready", ready: true });
    const readySummary = (await call("get_episode", { episode_id: ep, summary: true, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(readySummary).toMatchObject({ episode_id: ep, status: "ready", ready: true, episode: { id: ep, status: "ready" } });

    await t.db.query(`update episodes set status = 'generating' where id = $1`, [ep]);
    const writing = (await call("get_episode", { episode_id: ep, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(writing).toMatchObject({ episode_id: ep, status: "generating", ready: false });
    const writingSummary = (await call("get_episode", { episode_id: ep, summary: true, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(writingSummary).toMatchObject({ episode_id: ep, status: "generating", ready: false, episode: { id: ep, status: "generating" } });
    const read = (await call("get_episode", { episode_id: ep, summary: true }, A.ctx)).structuredContent;
    expect(read).toMatchObject({ episode_id: ep, status: "generating", ready: false, episode: { id: ep } });
  });

  it("my_characters takes compact and keeps its { characters } shape", async () => {
    const A = await agent("Ada Lumen");
    const full = (await call("my_characters", {}, A.ctx)).structuredContent;
    const compact = await call("my_characters", { compact: true }, A.ctx);
    expect(compact.isError).toBeFalsy();
    // The same keys, but for the notes this connection already had (left out and named in notes_left_out).
    const keys = (d: Any) => Object.keys(d).filter((k) => !k.endsWith("_note") && k !== "notes_left_out").sort();
    expect(keys(compact.structuredContent)).toEqual(keys(full));
    expect(compact.structuredContent.characters).toHaveLength(1);
    expect(compact.structuredContent.characters[0]).toMatchObject({ id: A.id, name: "Ada Lumen", open_to_dates: expect.any(Boolean), in_decks: expect.any(Boolean), partner_style: expect.any(String), visibility: "public" });
    expect(compact.structuredContent.characters[0]).not.toHaveProperty("soul");
    expect(full.characters[0]).toMatchObject({ id: A.id, name: "Ada Lumen" });
  });
});

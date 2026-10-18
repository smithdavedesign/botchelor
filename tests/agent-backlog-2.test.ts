import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, normaliseArgs, type McpContext } from "@/lib/mcp";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The agent-feedback issues from the 2026-10-18 visitor runs (#235–#238, #243, #244, #247–#249).
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
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;

async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-backlog-2-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

async function agentWith(name: string, extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const c = (await call("create_character", validCharacter({ name, ...extra }), ctx)).structuredContent;
  return { ctx, agentId: c.agent_id as string, id: c.character.id as string };
}

async function showDate(ctx: McpContext, id: string, extra: Record<string, unknown> = {}) {
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  return (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, ...extra }, ctx)).structuredContent;
}

describe("private dates say what they mean (#235, #244)", () => {
  it("a reflection on a private date says it won't carry forward, never 'once it airs'", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const ep = (await showDate(ctx, id, { visibility: "private" })).episode;
    const r = (await call("reflect_on_date", { episode_id: ep.id, character_id: id, reflection: "I talked too much about maps." }, ctx)).structuredContent;
    expect(r.carried_forward).toBe(false);
    expect(r.note).toMatch(/private date/);
    expect(r.note).not.toMatch(/once the date airs/);
  });

  it("plan_second_date before airing tells a private date's owner how to make it airable", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const ep = (await showDate(ctx, id, { visibility: "private" })).episode;
    await t.db.query(`update episodes set revealed_at = null where id = $1`, [ep.id]);
    const r = await call("plan_second_date", { episode_id: ep.id }, ctx);
    expect(r.content[0].text).toMatch(/private.*set_date_visibility/s);
  });
});

describe("arguments agents guess (#238, #247)", () => {
  it("rate_character reads rating/kind/type as category, and 'like' as likable", () => {
    expect(normaliseArgs("rate_character", { character_id: "x", rating: "like" })).toEqual({ args: { character_id: "x", category: "like" }, aliased: ["rating → category"] });
  });

  it("rating with 'like' rates likable", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    const r = await call("rate_character", { character_id: HOUSE_PARTNER_ID, rating: "like" }, ctx);
    expect(r.isError).toBeUndefined();
    expect(JSON.stringify(r.structuredContent)).toMatch(/likable/);
  });

  it("check_originality takes a whole create_character sheet without calling anything ignored", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    const r = (await call("check_originality", validCharacter({ name: "Cy Marr", open_to_dates: true }), ctx)).structuredContent;
    expect(r.ignored_arguments ?? []).toEqual([]);
  });
});

describe("waiting and starting (#243, #248)", () => {
  it("wait_for_episode that times out says it's still being written, not a half-built episode", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const ep = (await showDate(ctx, id)).episode;
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [ep.id]);
    const w = (await call("wait_for_episode", { episode_id: ep.id, timeout_seconds: 1 }, ctx)).structuredContent;
    expect(w).toMatchObject({ status: "generating", ready: false, retry: expect.stringMatching(/wait_for_episode again/) });
    expect(w.transcript).toBeUndefined();
  });

  it("the server's instructions say to start with my_status, and that private dates spend a weekly date too", async () => {
    const ctx: McpContext = {};
    const init = (await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "x" } } }, ctx))!.result as Any;
    expect(init.instructions).toMatch(/START with my_status/);
    expect(init.instructions).toMatch(/public and private alike/);
  });
});

describe("names (#249)", () => {
  it("an exact name another character has is refused before saving, unless keep_name: true", async () => {
    await agentWith("Ada Lumen");
    const ctx = await connect();
    const refused = await call("create_character", validCharacter({ name: "ada lumen" }), ctx);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/already a Ada Lumen.*keep_name: true/s);
    expect((await t.db.query(`select 1 from characters where lower(name) = 'ada lumen'`)).rows).toHaveLength(1);
    const kept = await call("create_character", validCharacter({ name: "ada lumen", keep_name: true }), ctx);
    expect(kept.isError).toBeUndefined();
  });
});

describe("two-agent dates: who's actually playing (#236)", () => {
  it("my_own_dates shows how long the date has waited on their line, and what each number means", async () => {
    const a = await agentWith("Ada Lumen");
    const b = await agentWith("Bo Quill", { open_to_dates: true });
    const step = (await call("start_own_date", { character_id: a.id, partner_id: b.id }, a.ctx)).structuredContent.step;
    await call("submit_own_date_step", { episode_id: step.episode_id, output: { dialogue: "So, maps?", action: "", emotion: "curious", interest_signal: 0.6 } }, a.ctx);
    await t.db.query(`update episodes set last_move_at = now() - interval '7 minutes' where id = $1`, [step.episode_id]);
    // B is around (texting, browsing), so last seen reads 0; the date has still waited 7 minutes on B's line.
    await call("my_status", {}, b.ctx);
    const row = (await call("my_own_dates", {}, a.ctx)).structuredContent.dates[0];
    expect(row).toMatchObject({ partner_last_seen_minutes: 0, their_move_waiting_minutes: 7, partner_note: expect.stringMatching(/any call/) });
  });
});

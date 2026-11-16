import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { airWindowMinutes } from "@/lib/air";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #1709 (the 2026-11-16-0610 run): a date aired on time, seconds after browse_episodes was read; predict then said a date
// "can air before its listed airs_at", and my_dates went on listing a due date as unaired.
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

async function agentWith(name: string) {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "aired-state-1709-test" } }, ctx);
  const session = { sessionId: ctx.issuedSessionId };
  const r = await call("create_character", validCharacter({ name }), session);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx: session, id: r.structuredContent.character.id as string };
}

describe("aired state (#1709)", () => {
  it("my_dates airs a date whose time has come, and predict says it aired on time", async () => {
    const host = await agentWith("Ada Lumen");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const booked = await call("go_on_date", { character_id: host.id, partner_id: HOUSE_PARTNER_ID }, host.ctx);
    expect(booked.isError).toBeFalsy();
    const id = booked.structuredContent.episode.id as string;

    const before = (await call("my_dates", {}, host.ctx)).structuredContent.dates.find((d: Any) => d.id === id);
    expect(before).toMatchObject({ aired: false, airs: "scheduled" });

    // Its prediction window has closed: it's due, and nothing else has aired it yet.
    await t.db.query(`update episodes set created_at = now() - make_interval(mins => $2::int + 1) where id = $1`, [id, airWindowMinutes()]);
    const after = (await call("my_dates", {}, host.ctx)).structuredContent.dates.find((d: Any) => d.id === id);
    expect(after).toMatchObject({ aired: true, revealed: true });
    expect(after.seconds_left).toBeUndefined();
    expect((await t.db.query<Any>(`select revealed_at from episodes where id = $1`, [id])).rows[0].revealed_at).not.toBeNull();

    const other = await agentWith("Bo Quill");
    const late = await call("predict", { episode_id: id, pick: "disaster" }, other.ctx);
    expect(late.isError).toBe(true);
    expect(late.content[0].text).toMatch(/already aired \(at .*, \d+ seconds? ago: on time, its airs_at was .*a list read just before then still showed it open\), so predictions are closed/);
    expect(late.content[0].text).not.toMatch(/can air before its listed airs_at/);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #1175 (the 2026-10-31-2052 run): a my_status wait that was already running when the agent's date came due slept to its
// timeout, because due dates aired only at the start of a call; the date_aired notice came on the next call.
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

describe("#1175: a my_status wait wakes when a date airs during it", () => {
  it("a date that comes due mid-wait airs on the wait's next poll, and its date_aired notice ends the wait", async () => {
    const ctx: McpContext = {};
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1175-test" } }, ctx);
    const session = { sessionId: ctx.issuedSessionId };
    const id = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), session)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const booked = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, visibility: "unlisted" }, session);
    expect(booked.isError).toBeFalsy();
    const ep = booked.structuredContent.episode.id as string;
    const cursor = (await call("my_status", {}, session)).structuredContent.cursor;

    // Due a second after the wait starts: the sweep at the call's start finds nothing to air.
    await t.db.query(`update episodes set air_after = now() + interval '1 second' where id = $1`, [ep]);
    const started = Date.now();
    const s = (await call("my_status", { since: cursor, wait_seconds: 8 }, session)).structuredContent;
    expect(s.returned_because).toBe("new");
    expect(s.new_since).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "date_aired" })]));
    expect(Date.now() - started).toBeLessThan(7000);
    expect((await t.db.query(`select revealed_at is not null as aired from episodes where id = $1`, [ep])).rows[0].aired).toBe(true);
  });

  it("get_episode's wait on a written date that hasn't aired says it waited for the writing, and what waits for the airing", async () => {
    const ctx: McpContext = {};
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1175-test" } }, ctx);
    const session = { sessionId: ctx.issuedSessionId };
    const id = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), session)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, visibility: "unlisted" }, session)).structuredContent.episode.id;
    const r = (await call("get_episode", { episode_id: ep, wait_seconds: 5 }, session)).structuredContent;
    expect(r.returned_because).toBe("at_start");
    expect(r.aired).toBe(false);
    expect(r.wait_note).toMatch(/^It's written and hasn't aired yet( \(airs_at [^)]+\))?: this wait is for the writing, so it returned\. my_status with wait_seconds wakes when it airs \(date_aired\)\.$/);
  });
});

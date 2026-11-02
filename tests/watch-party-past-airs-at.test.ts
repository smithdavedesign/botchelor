import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { airDueDates, airTimings, WATCH_DECISION_SECONDS } from "@/lib/air";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #839 (run 2026-10-25-0346): a watch party's date whose listed airs_at had passed was listed as open with seconds_left 0
// and took picks, with nothing saying it airs only when its room is opened. Now airs_note says so, and it sorts last.
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
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "watch-party-839-test" } }, ctx);
  const s = { sessionId: ctx.issuedSessionId };
  const made = await call("create_character", validCharacter({ name, keep_name: true }), s);
  if (made.isError) throw new Error(made.content[0].text);
  return { ctx: s, id: made.structuredContent.character.id as string };
}
async function booked(host: { ctx: McpContext; id: string }) {
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  return (await call("go_on_date", { character_id: host.id, partner_id: HOUSE_PARTNER_ID }, host.ctx)).structuredContent.episode.id as string;
}

it("a watch party past its decision is due like any other date: the hourly job airs it, and nothing says it waits on a room", async () => {
  // 2026-11-02: a premiere nobody came back to never aired (its morning-after texts, memory and picks all waited on it).
  const party = await booked(await agent("Ada Lumen"));
  const live = await booked(await agent("Cy Marlow"));
  await t.db.query(`update episodes set created_at = now() - interval '1 day' where id = any($1)`, [[party, live]]);
  const past = new Date(Date.now() - 24 * 3600_000);
  const justStarted = new Date(Date.now() - 60_000);
  await t.db.query(`insert into watch_parties (id, episode_id, kind, starts_at) values ('wp-839', $1, 'premiere', $2), ('wp-live', $3, 'premiere', $4)`, [
    party, past.toISOString(), live, justStarted.toISOString(),
  ]);

  const timing = (await airTimings(t.db, [party, live]));
  expect(timing.get(party)).toMatchObject({ airs: "due", seconds_left: 0 });
  expect(timing.get(party)!.airs_note).toBeUndefined();
  // A room still before its decision keeps its date for whoever is watching.
  expect(timing.get(live)).toMatchObject({ airs: "watch_party", airs_at: justStarted.toISOString() });
  expect(timing.get(live)!.airs_note).toBeUndefined();

  expect((await airDueDates(t.db)).map((a) => a.id)).toEqual([party]);
  const aired = (await t.db.query(`select id from episodes where revealed_at is not null`)).rows.map((r) => r.id);
  expect(aired).toEqual([party]);
  expect(WATCH_DECISION_SECONDS).toBeGreaterThan(60);
});

it("a watch party with a start time still ahead has no airs_note; one with none says so", async () => {
  const host = await agent("Ada Lumen");
  const id = await booked(host);
  const ahead = new Date(Date.now() + 45 * 60_000);
  await t.db.query(`insert into watch_parties (id, episode_id, kind, starts_at) values ('wp-839', $1, 'premiere', $2)`, [id, ahead.toISOString()]);
  expect((await airTimings(t.db, [id])).get(id)!.airs_note).toBeUndefined();
  await t.db.query(`update watch_parties set starts_at = null where id = 'wp-839'`);
  expect((await airTimings(t.db, [id])).get(id)!.airs_note).toMatch(/No start time/);
});

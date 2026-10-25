import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { airTimings } from "@/lib/air";
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

it("a watch party past its start time says it waits on its room, in browse_episodes and predict, and lists after dates that air on their own", async () => {
  const party = await booked(await agent("Ada Lumen"));
  const plain = await booked(await agent("Cy Marlow"));
  const past = new Date(Date.now() - 24 * 3600_000);
  await t.db.query(`insert into watch_parties (id, episode_id, kind, starts_at) values ('wp-839', $1, 'premiere', $2)`, [party, past.toISOString()]);

  const timing = (await airTimings(t.db, [party])).get(party)!;
  expect(timing).toMatchObject({ airs: "watch_party", airs_at: past.toISOString(), seconds_left: 0 });
  expect(timing.airs_note).toMatch(/listed time has passed/);
  expect(timing.airs_note).toMatch(/opens its watch party/);

  const viewer = await agent("Bo Quill");
  const r = (await call("browse_episodes", { open: true }, viewer.ctx)).structuredContent;
  const ids = r.episodes.map((e: Any) => e.id);
  expect(ids.indexOf(plain)).toBeLessThan(ids.indexOf(party));
  expect(r.episodes.find((e: Any) => e.id === party).airs_note).toMatch(/listed time has passed/);
  expect(r.episodes.find((e: Any) => e.id === plain).airs_note).toBeUndefined();
  expect(r.next_calls[0].args.episode_id).toBe(plain);

  const pick = (await call("predict", { episode_id: party, pick: "friends" }, viewer.ctx)).structuredContent;
  expect(pick.note).toMatch(/only when someone opens its watch party room/);
  expect(pick.note).toMatch(/has passed/);
  expect(pick.airs_note).toMatch(/listed time has passed/);
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

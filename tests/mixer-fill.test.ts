import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";
import { runDueMixers } from "@/lib/group-dates-run";
import { fillMixerTonight, MIXER_FILL_HOUR_UTC, pickFillers } from "@/lib/mixer-fill";
import { mixerNightView } from "@/lib/mixer-night";
import { addLink } from "@/lib/character-links";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { shortName } from "@/lib/names";
import { setSeasonCastForTests } from "@/lib/season-cast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

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

const send = async (method: string, params: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  (await send("tools/call", { name, arguments: args }, ctx)).result;
/** An agent with one character; `client` botchelor-loop-crowd-… makes it one of the labelled house crowd. */
async function agent(name: string, client = "mixer-fill-test") {
  const ctx: McpContext = { userAgent: "test-agent/1.0" };
  await send("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client, version: "1" } }, ctx);
  const c = { sessionId: ctx.issuedSessionId, userAgent: ctx.userAgent };
  const made = (await call("create_character", validCharacter({ name }), c)).structuredContent;
  await t.db.query(`update characters set open_to_dates = true where id = $1`, [made.character.id]);
  return { ctx: c, id: made.character.id as string, agentId: made.agent_id as string };
}
const CROWD = ["Bram Oak", "Cleo Fen", "Dax Rook", "Esme Vale", "Fitz Moor", "Gil Thorn", "Hana Reed", "Ivo Lark", "Jade Wren", "Kai Fern", "Lux Brae", "Mira Holt"];
const crowd = async (n = CROWD.length) => {
  const out = [];
  for (const name of CROWD.slice(0, n)) out.push(await agent(name, `botchelor-loop-crowd-${name.split(" ")[0].toLowerCase()}`));
  return out;
};
/** A fixed evening (UTC), `day` days on. */
const evening = (day = 0, hour = MIXER_FILL_HOUR_UTC) => new Date(Date.UTC(2030, 0, 15 + day, hour, 30));

describe("the nightly mixer fill (lib/mixer-fill.ts)", () => {
  it("with nobody in, the house runs a mixer of its own crowd at the fill hour, house-paid, and tags them", async () => {
    const bots = await crowd(8);
    expect(await fillMixerTonight(t.db, evening(0, MIXER_FILL_HOUR_UTC - 1))).toBeNull(); // not yet
    scriptOutcome({ ending: "friends" });
    scriptedModel(Array.from({ length: 6 }, () => episodeJson()));
    const run = await runDueMixers(t.db, evening());
    const night = (await t.db.query<Any>(`select id, status, filled_at, created_by, rotations from group_nights where kind = 'mixer'`)).rows;
    expect(night).toHaveLength(1);
    const seats = (await t.db.query<Any>(`select character_id, booker, house_fill from group_night_seats where night_id = $1`, [night[0].id])).rows;
    expect(seats.length).toBeGreaterThanOrEqual(4);
    expect(seats.length).toBeLessThanOrEqual(6);
    expect(seats.every((s: Any) => s.house_fill)).toBe(true);
    expect(run).toMatchObject({ ran: 1, filled: seats.length, booked: seats.length, failed: 0 });
    expect(night[0].status).toBe("done");
    expect(night[0].rotations.every((r: Any) => r.house_paid === true)).toBe(true);
    // The house paid: none of the bots spent one of their own dates.
    expect((await t.db.query<Any>(`select count(*)::int as n from free_episode_usage where user_id = any($1)`, [bots.map((b) => b.agentId)])).rows[0].n).toBe(0);
    // The room tags every one of them as the house's.
    const view = (await mixerNightView(t.db, night[0].id, null))!;
    expect(view.seats.every((s) => s.house_run)).toBe(true);
    // Once a day: a later pass the same evening does nothing more.
    expect(await fillMixerTonight(t.db, evening(0, 22))).toBeNull();

    // The next night, nobody who filled tonight fills again.
    scriptedModel(Array.from({ length: 6 }, () => episodeJson()));
    await runDueMixers(t.db, evening(1));
    const nights = (await t.db.query<Any>(`select id from group_nights where kind = 'mixer' order by created_at`)).rows;
    expect(nights).toHaveLength(2);
    const second = (await t.db.query<Any>(`select character_id from group_night_seats where night_id = $1`, [nights[1].id])).rows.map((r: Any) => r.character_id);
    expect(second.length).toBeGreaterThanOrEqual(4);
    for (const id of second) expect(seats.map((s: Any) => s.character_id)).not.toContain(id);
  });

  it("tops a short people's mixer up to four; people pay theirs, the house its own; an unmatched bot stays out", async () => {
    const people = [await agent("Juni Marsh"), await agent("Pia Voss")];
    for (const p of people) expect((await call("mixer", { join: p.id, agent_id: p.agentId }, p.ctx)).isError).toBeUndefined();
    const bots = await crowd(4);
    // Juni unmatched one of the crowd: it never sits in Juni's room.
    const [lo, hi] = [people[0].id, bots[0].id].sort();
    await t.db.query(`insert into unmatches (character_lo, character_hi, by_character) values ($1, $2, $3)`, [lo, hi, people[0].id]);
    scriptOutcome({ ending: "friends" });
    scriptedModel(Array.from({ length: 4 }, () => episodeJson()));
    expect(await runDueMixers(t.db, evening())).toMatchObject({ ran: 1, filled: 2, booked: 4 });
    const seats = (await t.db.query<Any>(`select character_id, house_fill from group_night_seats`)).rows;
    expect(seats).toHaveLength(4);
    expect(seats.filter((s: Any) => s.house_fill)).toHaveLength(2);
    expect(seats.map((s: Any) => s.character_id)).not.toContain(bots[0].id);
    const rotations = (await t.db.query<Any>(`select rotations from group_nights`)).rows[0].rotations;
    const fillers = new Set(seats.filter((s: Any) => s.house_fill).map((s: Any) => s.character_id));
    for (const r of rotations) expect(Boolean(r.house_paid)).toBe(fillers.has(r.a));
    // Each person spent their one date; no bot spent any.
    const used = (await t.db.query<Any>(`select user_id, used from free_episode_usage`)).rows;
    expect(used.map((u: Any) => u.user_id).sort()).toEqual(people.map((p) => p.agentId).sort());
    // Only people and agents get the wrap, never the house's fillers.
    const wraps = (await t.db.query<Any>(`select user_id from notifications where kind = 'mixer'`)).rows.map((r: Any) => r.user_id);
    expect(wraps.sort()).toEqual(people.map((p) => p.agentId).sort());
  });

  it("stays out when the crowd is paused or a mixer already ran today; a people-only room gets the cast, never the crowd", async () => {
    await crowd(6);
    vi.stubEnv("HOUSE_CROWD_PAUSED", "1");
    expect(await fillMixerTonight(t.db, evening())).toBeNull();
    vi.unstubAllEnvs();
    vi.stubEnv("MIXER_HOUSE_FILL", "0");
    expect(await fillMixerTonight(t.db, evening())).toBeNull();
    vi.unstubAllEnvs();

    const p = await agent("Juni Marsh");
    await t.db.query(`update characters set open_audience = 'people' where id = $1`, [p.id]);
    expect((await call("mixer", { join: p.id, agent_id: p.agentId }, p.ctx)).isError).toBeUndefined();
    // A room with someone who wants people only gets no agent-made crowd: the house cast (made on the web) fills it.
    const filled = (await fillMixerTonight(t.db, evening()))!;
    expect(filled.filled).toBe(3);
    const seatedNow = (await t.db.query<Any>(`select c.is_house from group_night_seats gs join characters c on c.id = gs.character_id where gs.house_fill`)).rows;
    expect(seatedNow.every((r: Any) => r.is_house)).toBe(true);
    await t.db.query(`delete from group_night_seats where house_fill`);
    await t.db.query(`update group_nights set filled_at = null`);
    // Take Juni out; a mixer that already ran today means no house night on top of it.
    expect((await call("mixer", { leave: p.id, agent_id: p.agentId }, p.ctx)).isError).toBeUndefined();
    await t.db.query(`update group_nights set status = 'done', decided_at = $1`, [evening(0, 18).toISOString()]);
    expect(await fillMixerTonight(t.db, evening())).toBeNull();
  });

  it("brings best friends in the cast together, seats them at different tables, and the room says so", async () => {
    const [x, y, z] = HOUSE_CHARACTERS;
    setSeasonCastForTests([x.id, y.id, z.id]);
    try {
      await addLink(t.db, x.id, y.id, "friends_to_more", "Neighbours for a decade.");
      // A people-only room gets the cast, never the crowd: three seats, the cast's share (one) first.
      const p = await agent("Juni Marsh");
      await t.db.query(`update characters set open_audience = 'people' where id = $1`, [p.id]);
      expect((await call("mixer", { join: p.id, agent_id: p.agentId }, p.ctx)).isError).toBeUndefined();
      scriptOutcome({ ending: "friends" });
      scriptedModel(Array.from({ length: 4 }, () => episodeJson()));
      expect(await runDueMixers(t.db, evening())).toMatchObject({ ran: 1, filled: 3, booked: 4 });
      const night = (await t.db.query<Any>(`select id, rotations, duos, room_opening from group_nights where kind = 'mixer'`)).rows[0];
      expect(night.duos).toEqual([[x.id, y.id].sort()]);
      // Never at one table: each spends the night on someone new.
      for (const r of night.rotations) expect([r.a, r.b].sort()).not.toEqual([x.id, y.id].sort());
      expect(night.room_opening).toContain(`arrive together, best friends, each here to wingman the other.`);
      // Every table either of them sits at hears who came with them.
      const eps = (await t.db.query<Any>(`select character_a, character_b, setup->>'table' as table from episodes`)).rows;
      const theirs = eps.filter((e: Any) => [e.character_a, e.character_b].includes(x.id));
      expect(theirs.length).toBeGreaterThan(0);
      for (const e of theirs) expect(e.table).toContain(`${shortName(x.name)} came tonight with best friend ${shortName(y.name)}`);
      // The night page tells the same room.
      const view = (await mixerNightView(t.db, night.id, null))!;
      expect(view.opening).toBe(night.room_opening);
      expect(view.tables.some((tb) => tb.beats.some((b) => b.text.startsWith(shortName(y.name)) && b.text.includes(shortName(x.name))))).toBe(true);
    } finally {
      setSeasonCastForTests(null);
    }
  });
});

describe("who fills the seats (pickFillers, pure)", () => {
  const c = (id: string) => ({ id });
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  it("brings best friends together or not at all, and splits them only when the room can't fill otherwise", () => {
    // The cast's share is two: a duo dealt first takes both seats.
    expect(ids(pickFillers([c("x"), c("z"), c("y")], [c("b1"), c("b2")], 4, [["x", "y"]]))).toEqual(["x", "y", "b1", "b2"]);
    // A share of one: the duo is passed over for a single, and the crowd fills the rest.
    expect(ids(pickFillers([c("x"), c("y"), c("z")], [c("b1"), c("b2")], 3, [["x", "y"]]))).toEqual(["z", "b1", "b2"]);
    // The crowd short: the duo comes on the cast's second pass, two seats being left.
    expect(ids(pickFillers([c("z"), c("x"), c("y")], [c("b1")], 5, [["x", "y"]]))).toEqual(["z", "b1", "x", "y"]);
    // One seat left and nobody else free: the room fills, and one of them comes alone.
    expect(ids(pickFillers([c("x"), c("y")], [c("b1"), c("b2")], 3, [["x", "y"]]))).toEqual(["b1", "b2", "x"]);
    // No duos: the deal's order, as before; never two who unmatched.
    expect(ids(pickFillers([c("x"), c("y"), c("z")], [c("b1"), c("b2")], 4, []))).toEqual(["x", "y", "b1", "b2"]);
    expect(ids(pickFillers([c("x"), c("z")], [c("b1"), c("b2"), c("b3")], 4, [], (p, q) => [p, q].sort().join() === "b1,x"))).toEqual(["x", "z", "b2", "b3"]);
  });
});

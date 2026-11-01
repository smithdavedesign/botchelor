import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";
import { runDueMixers } from "@/lib/group-dates-run";
import { airEpisode } from "@/lib/air";
import { backgroundBeats, playOrder, roomClosing, roomLine, roomOpening, roundCount, roundOf, rotationRound, type RoomRotation } from "@/lib/mixer-room";
import { mixerNightOf, mixerNightView } from "@/lib/mixer-night";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** A circle of `n` seats, the way the mixer draws it (seat i meets seat i+1). */
const circle = (n: number): RoomRotation[] => Array.from({ length: n }, (_, i) => ({ a: `s${i}`, b: `s${(i + 1) % n}`, round: roundOf(i, n) }));

describe("the mixer's rounds and room (lib/mixer-room.ts, pure)", () => {
  it("deals a circle into rounds where nobody is at two tables at once", () => {
    for (const n of [4, 5, 6]) {
      const rots = circle(n);
      const rounds = new Set(rots.map((_, i) => rotationRound(rots, i)));
      expect(rounds.size).toBe(roundCount(n));
      for (const r of rounds) {
        const people = rots.filter((_, i) => rotationRound(rots, i) === r).flatMap((x) => [x.a, x.b]);
        expect(new Set(people).size).toBe(people.length);
      }
      // Played round by round: every round-0 table before any round-1 table.
      const order = playOrder(rots).map((i) => rotationRound(rots, i));
      expect(order).toEqual([...order].sort((x, y) => x - y));
    }
    expect(roundCount(4)).toBe(2);
    expect(roundCount(5)).toBe(3);
    // A night stored before the room (no round on its rotations) is dealt the same way from the index.
    const old = circle(6).map(({ a, b }) => ({ a, b }));
    expect(old.map((_, i) => rotationRound(old, i))).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it("the room line names the whole room, the round, the earlier rounds and the beats around the table", () => {
    const rots = circle(4);
    const names = new Map([["s0", "Juni Marsh"], ["s1", "Pia Voss"], ["s2", "Sol Vega"], ["s3", "Kit Crag"]]);
    const seats = ["s0", "s1", "s2", "s3"];
    const first = roomLine({ nightId: "n1", venue: "dive_bar", rotations: rots, i: 0, names, seatIds: seats, endings: new Map() });
    expect(first).toMatch(/everyone in one room: Sol, Kit are here too/);
    expect(first).toMatch(/round 1 of 2/);
    expect(first).not.toMatch(/Earlier tonight/);
    // The other round-1 table (Sol × Kit) is a beat around Juni × Pia.
    expect(first).toMatch(/Around you this round: .*(Sol|Kit)/);
    const second = roomLine({ nightId: "n1", venue: "dive_bar", rotations: rots, i: 1, names, seatIds: seats, endings: new Map([[0, "second_date"], [2, "disaster"]]) });
    expect(second).toMatch(/round 2 of 2/);
    expect(second).toMatch(/Earlier tonight, from across the room — Juni and Pia: leaning in by the bell; Sol and Kit: a table that went quiet early/);
    // Never the verdict's words: the room only sees how a table looked.
    expect(second).not.toMatch(/second date|disaster/i);
    // An odd circle's last round is one table, and the rest watch from the bar.
    const five = circle(5);
    const bar = backgroundBeats("n2", five, 4, new Map(five.map((r) => [r.a, r.a.toUpperCase()])), ["s0", "s1", "s2", "s3", "s4"]);
    expect(bar).toHaveLength(2);
    for (const b of bar) expect(b.text).toMatch(/S[123]/);
    // Dealt from the night: the same night always tells the same room.
    expect(backgroundBeats("n2", five, 4, new Map(), ["s0", "s1", "s2", "s3", "s4"])).toEqual(backgroundBeats("n2", five, 4, new Map(), ["s0", "s1", "s2", "s3", "s4"]));
  });

  it("opens with everyone seated and closes with who leaves with whom", () => {
    expect(roomOpening("n1", "dive_bar", ["Juni Marsh", "Pia Voss", "Sol Vega"])).toMatch(/Juni, Pia and Sol/);
    const names = new Map([["s0", "Juni Marsh"], ["s1", "Pia Voss"], ["s2", "Sol Vega"], ["s3", "Kit Crag"]]);
    const closing = roomClosing(
      "dive_bar",
      [
        { a: "s0", b: "s1", ending: "second_date" },
        { a: "s1", b: "s2", ending: "second_date" },
        { a: "s2", b: "s3", ending: "disaster" },
        { a: "s3", b: "s0", ending: "friends" },
      ],
      names,
      ["s0", "s1", "s2", "s3"],
    );
    expect(closing).toMatch(/Juni and Pia leave together\./);
    expect(closing).toMatch(/Sol slips Pia a number on the way out\./);
    expect(closing).toMatch(/Kit heads home on their own\./);
    expect(closing).toMatch(/empties out/);
  });
});

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
async function agent(name: string) {
  const ctx: McpContext = { userAgent: "test-agent/1.0" };
  await send("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "mixer-room-test", version: "1" } }, ctx);
  const c = { sessionId: ctx.issuedSessionId, userAgent: ctx.userAgent };
  const made = (await call("create_character", validCharacter({ name }), c)).structuredContent;
  return { ctx: c, id: made.character.id as string, agentId: made.agent_id as string };
}

describe("a mixer night is one room (booking + the night page's view)", () => {
  it("books round by round with the room in every table's line, and the night page plays it once it airs", async () => {
    const singles = [await agent("Juni Marsh"), await agent("Pia Voss"), await agent("Sol Vega"), await agent("Kit Crag"), await agent("Ada Lune")];
    for (const s of singles) expect((await call("mixer", { join: s.id, agent_id: s.agentId }, s.ctx)).isError).toBeUndefined();
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson(), episodeJson(), episodeJson(), episodeJson(), episodeJson()]);
    expect(await runDueMixers(t.db, new Date(Date.now() + 31 * 60_000))).toMatchObject({ ran: 1, booked: 5, failed: 0 });

    const night = (await t.db.query<Any>(`select id, rotations from group_nights where kind = 'mixer'`)).rows[0];
    // The scripted model writes no line-by-line conversation; give every table its six lines as the actors would.
    const six = Array.from({ length: 6 }, (_, k) => ({ side: k % 2 ? "b" : "a", act: Math.floor(k / 2), dialogue: `Line ${k + 1}.`, action: "", emotion: "warm" }));
    await t.db.query(`update episodes set transcript = $1::jsonb`, [JSON.stringify(six)]);
    expect(night.rotations.map((r: Any) => r.round)).toEqual([0, 1, 0, 1, 2]);
    // Booked in the bell's order, and each table's line is the room: everyone else, its round, the earlier rounds.
    const eps = (await t.db.query<Any>(`select id, setup->>'table' as table from episodes order by created_at`)).rows;
    expect(eps.map((e: Any) => e.id)).toEqual(playOrder(night.rotations).map((i) => night.rotations[i].episode_id));
    for (const e of eps) expect(e.table).toMatch(/everyone in one room/);
    const byEpisode = new Map(night.rotations.map((r: Any) => [r.episode_id, r]));
    for (const e of eps) {
      const r = byEpisode.get(e.id) as Any;
      expect(e.table).toMatch(new RegExp(`round ${r.round + 1} of 3`));
      if (r.round === 0) expect(e.table).not.toMatch(/Earlier tonight/);
      else expect(e.table).toMatch(/Earlier tonight, from across the room — .*leaning in by the bell/);
    }

    // Before anything airs: a stranger sees the tables in order but no lines, and no closing (it would spoil endings).
    const before = (await mixerNightView(t.db, night.id, null))!;
    expect(before.rounds).toBe(3);
    expect(before.seats).toHaveLength(5);
    expect(before.tables.map((x) => x.round)).toEqual([0, 0, 1, 1, 2]);
    expect(before.tables.every((x) => x.state === "airs_soon" && x.turns.length === 0)).toBe(true);
    expect(before.closing).toBeNull();
    expect(before.opening).toMatch(/Juni/);
    // A table's own creator reads their lines straight away, like on its own page.
    const mine = night.rotations[0];
    const own = (await mixerNightView(t.db, night.id, mine.booker))!.tables.find((x) => x.index === 0)!;
    expect(own.state).toBe("ready");
    expect(own.turns.length).toBeGreaterThan(0);

    // Aired: everyone reads every table, with the room's beats, and the closing says who left with whom.
    for (const r of night.rotations) expect(await airEpisode(t.db, r.episode_id, r.booker)).not.toBeNull();
    const after = (await mixerNightView(t.db, night.id, null))!;
    expect(after.tables.every((x) => x.state === "ready" && x.turns.length > 0 && x.ending_label)).toBe(true);
    expect(after.tables.every((x) => x.turns.length === 6 && x.beats.length > 0)).toBe(true);
    expect(after.closing).toMatch(/leave together/);
    expect(after.closing).toMatch(/empties out/);

    // Each table's page links back to the night, with its round.
    const lastTable = night.rotations[4];
    expect(await mixerNightOf(t.db, lastTable.episode_id)).toEqual({ night_id: night.id, venue: expect.any(String), round: 3, rounds: 3 });
    // The wrap points at the whole night.
    const wrap = (await t.db.query<Any>(`select link from notifications where user_id = $1 and kind = 'mixer'`, [singles[0].agentId])).rows;
    expect(wrap[0].link).toBe(`/mixers/${night.id}`);
  });
});

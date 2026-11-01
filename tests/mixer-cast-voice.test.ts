import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { api, episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";
import { runDueMixers } from "@/lib/group-dates-run";
import { castShare, MIXER_FILL_HOUR_UTC } from "@/lib/mixer-fill";
import { mixerNightView } from "@/lib/mixer-night";
import { setMixerVoiceEnabledForTests, writeBeat } from "@/lib/mixer-voice";
import { HOUSE_BOOKER } from "@/lib/house-booker";
import { airEpisode } from "@/lib/air";
import { USER_COOKIE } from "@/lib/http";

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
  setMixerVoiceEnabledForTests(false);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const send = async (method: string, params: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  (await send("tools/call", { name, arguments: args }, ctx)).result;
async function agent(name: string, client = "mixer-cast-test") {
  const ctx: McpContext = { userAgent: "test-agent/1.0" };
  await send("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client, version: "1" } }, ctx);
  const c = { sessionId: ctx.issuedSessionId, userAgent: ctx.userAgent };
  const made = (await call("create_character", validCharacter({ name }), c)).structuredContent;
  await t.db.query(`update characters set open_to_dates = true where id = $1`, [made.character.id]);
  return { ctx: c, id: made.character.id as string, agentId: made.agent_id as string };
}
const crowd = async (names: string[]) => {
  const out = [];
  for (const name of names) out.push(await agent(name, `botchelor-loop-crowd-${name.split(" ")[0].toLowerCase()}`));
  return out;
};
const evening = (day = 0) => new Date(Date.UTC(2030, 0, 15 + day, MIXER_FILL_HOUR_UTC, 30));
const SIX = Array.from({ length: 6 }, (_, k) => ({ side: k % 2 ? "b" : "a", act: Math.floor(k / 2), dialogue: `Line ${k + 1}.`, action: "", emotion: "warm" }));

describe("the house cast fills mixer seats too (lib/mixer-fill.ts + lib/house-booker.ts)", () => {
  it("a house night is half cast, half crowd; the house books and pays the cast's tables; no filler hears a thing", async () => {
    const bots = await crowd(["Bram Oak", "Cleo Fen", "Dax Rook", "Esme Vale", "Fitz Moor", "Gil Thorn"]);
    const before = (await t.db.query<Any>(`select count(*)::int as n from notifications where user_id = any($1)`, [[...bots.map((b) => b.agentId), HOUSE_BOOKER]])).rows[0].n;
    scriptOutcome({ ending: "second_date" });
    scriptedModel(Array.from({ length: 6 }, () => episodeJson()));
    const run = await runDueMixers(t.db, evening());
    const seats = (await t.db.query<Any>(`select gs.character_id, gs.booker, gs.house_fill, c.is_house from group_night_seats gs join characters c on c.id = gs.character_id`)).rows;
    expect(run).toMatchObject({ ran: 1, booked: seats.length, failed: 0 });
    const castSeats = seats.filter((s: Any) => s.is_house);
    expect(castSeats).toHaveLength(castShare(seats.length));
    expect(seats.length - castSeats.length).toBeGreaterThanOrEqual(castSeats.length); // the cast never crowds the bots out
    for (const s of castSeats) expect(s.booker).toBe(HOUSE_BOOKER);
    const night = (await t.db.query<Any>(`select id, rotations from group_nights`)).rows[0];
    const castIds = new Set(castSeats.map((s: Any) => s.character_id));
    const houseBooked = night.rotations.filter((r: Any) => castIds.has(r.a));
    expect(houseBooked.length).toBe(castSeats.length);
    for (const r of houseBooked) {
      expect(r.booker).toBe(HOUSE_BOOKER);
      expect(r.house_paid).toBe(true);
      expect(r.episode_id).toBeTruthy();
    }
    // The room tags the cast House too.
    const view = (await mixerNightView(t.db, night.id, null))!;
    expect(view.seats.every((s) => s.house_run)).toBe(true);

    // Air everything: still not one notice to a filler or the house (no wrap, no booked, no aired, no "who did you like?").
    await t.db.query(`update episodes set transcript = $1::jsonb`, [JSON.stringify(SIX)]);
    for (const r of night.rotations) expect(await airEpisode(t.db, r.episode_id, r.booker)).not.toBeNull();
    const after = (await t.db.query<Any>(`select count(*)::int as n from notifications where user_id = any($1)`, [[...bots.map((b) => b.agentId), HOUSE_BOOKER]])).rows[0].n;
    const kinds = (await t.db.query<Any>(`select kind, title from notifications where user_id = any($1)`, [[...bots.map((b) => b.agentId), HOUSE_BOOKER]])).rows;
    expect(kinds).toEqual([]);
    expect(after).toBe(before);
  });

  it("only the mixer run can book as the house: the same id from outside is a stranger with no characters", async () => {
    const castId = (await t.db.query<Any>(`select id from characters where is_house limit 1`)).rows[0].id;
    const other = (await t.db.query<Any>(`select id from characters where is_house offset 1 limit 1`)).rows[0].id;
    const res = await api.createEpisode({ character_id: castId, partner_id: other, group_night: crypto.randomUUID() }, `${USER_COOKIE}=${HOUSE_BOOKER}`);
    expect(res.status).toBe(404);
  });

  it("a person in a topped-up night hears of it; the house's filler never does", async () => {
    const people = [await agent("Juni Marsh"), await agent("Pia Voss")];
    for (const p of people) expect((await call("mixer", { join: p.id, agent_id: p.agentId }, p.ctx)).isError).toBeUndefined();
    const bots = await crowd(["Bram Oak", "Cleo Fen"]);
    scriptOutcome({ ending: "friends" });
    scriptedModel(Array.from({ length: 4 }, () => episodeJson()));
    expect(await runDueMixers(t.db, evening())).toMatchObject({ ran: 1, filled: 2, booked: 4 });
    const fillers = (await t.db.query<Any>(`select c.is_house from group_night_seats gs join characters c on c.id = gs.character_id where gs.house_fill`)).rows;
    expect(fillers.map((f: Any) => f.is_house).sort()).toEqual([false, true]); // 1 cast + 1 crowd
    const night = (await t.db.query<Any>(`select rotations from group_nights`)).rows[0];
    await t.db.query(`update episodes set transcript = $1::jsonb`, [JSON.stringify(SIX)]);
    for (const r of night.rotations) await airEpisode(t.db, r.episode_id, r.booker);
    const toBots = (await t.db.query<Any>(`select count(*)::int as n from notifications where user_id = any($1) and kind in ('mixer', 'group_reflect', 'date_booked_with_yours', 'date_aired')`, [[...bots.map((b) => b.agentId), HOUSE_BOOKER]])).rows[0].n;
    expect(toBots).toBe(0);
    const reflect = (await t.db.query<Any>(`select user_id from notifications where kind = 'group_reflect'`)).rows.map((r: Any) => r.user_id).sort();
    expect(reflect).toEqual(people.map((p) => p.agentId).sort());
  });
});

describe("the room's own words (lib/mixer-voice.ts)", () => {
  it("checks a beat: JSON, the content filter, English, length, and the names it must keep", async () => {
    const model = (out: string) => ({ complete: async () => out });
    expect(await writeBeat(model(`{"text":"Juni and Pia trade a look over the bell as the dive bar fills."}`), "x", ["Juni", "Pia"])).toMatch(/Juni and Pia/);
    expect(await writeBeat(model("not json"), "x", [])).toBeNull();
    expect(await writeBeat(model(`{"text":"Juni waves."}`), "x", ["Juni"])).toBeNull(); // too short to be a beat
    expect(await writeBeat(model(`{"text":"Everyone settles in at the bar, the bell waiting on the counter."}`), "x", ["Juni"])).toBeNull(); // lost a name
    expect(await writeBeat(model(`{"text":"Juni y Pia se sientan juntos en el bar, mirando la campana con nervios."}`), "x", ["Juni"])).toBeNull(); // not English
    expect(await writeBeat({ complete: async () => { throw new Error("down"); } }, "x", [])).toBeNull();
    const long = await writeBeat(model(JSON.stringify({ text: `Juni laughs. ${"The room hums along nicely. ".repeat(40)}` })), "x", ["Juni"]);
    expect(long!.length).toBeLessThanOrEqual(420);
  });

  it("writes the opening when the night runs and the closing when the last table airs, once, and the page shows them", async () => {
    setMixerVoiceEnabledForTests(true);
    const singles = [await agent("Juni Marsh"), await agent("Pia Voss"), await agent("Sol Vega"), await agent("Kit Crag")];
    for (const s of singles) expect((await call("mixer", { join: s.id, agent_id: s.agentId }, s.ctx)).isError).toBeUndefined();
    scriptOutcome({ ending: "second_date" });
    const opening = `{"text":"Juni, Pia, Sol and Kit shuffle in under the neon, name tags crooked, eyeing the brass bell on the bar."}`;
    const scripted = scriptedModel([opening, episodeJson(), episodeJson(), episodeJson(), episodeJson()]);
    expect(await runDueMixers(t.db, new Date(Date.now() + 31 * 60_000))).toMatchObject({ ran: 1, booked: 4 });
    // The opening's call went to the model first, with the room in it.
    expect(scripted.calls[0][1].content).toMatch(/Juni, Pia, Sol, Kit/);
    const night = (await t.db.query<Any>(`select id, rotations, room_opening, room_opening_by, room_closing from group_nights`)).rows[0];
    expect(night.room_opening_by).toBe("model");
    expect(night.room_opening).toMatch(/brass bell/);
    expect(night.room_closing).toBeNull();
    const before = (await mixerNightView(t.db, night.id, null))!;
    expect(before.opening).toMatch(/brass bell/);
    expect(before.closing).toBeNull();

    // The closing: one call when the last table airs, told the template's facts; the model refuses → the template stands.
    await t.db.query(`update episodes set transcript = $1::jsonb`, [JSON.stringify(SIX)]);
    scriptedModel([`{"text":"I can't help with that."}`]);
    for (const r of night.rotations) await airEpisode(t.db, r.episode_id, r.booker);
    const closed = (await t.db.query<Any>(`select room_closing, room_closing_by from group_nights`)).rows[0];
    expect(closed.room_closing_by).toBe("template");
    expect(closed.room_closing).toMatch(/leave together/);
    // Stored once: opening the page asks no model (the scripted model has nothing left to give).
    const after = (await mixerNightView(t.db, night.id, null))!;
    expect(after.closing).toBe(closed.room_closing);
  });
});

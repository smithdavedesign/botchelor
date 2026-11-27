import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { characterPublicView, characterSelfView, loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { dayCandidates, dayLines, goalsOf, lifeDays, readDayReply, setGoal, updateGoal, vetoShift, writeDay } from "@/lib/life-days";
import { runLifeTool } from "@/lib/life-mcp";
import { loadLife, loadLifeAll } from "@/lib/life-record";
import { growthLines, traitTotals, type TraitShift } from "@/lib/life-record-shared";
import type { Model } from "@/lib/model";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
const MINE = HOUSE_CHARACTERS[4].id;
const OTHER = HOUSE_CHARACTERS[5].id;
beforeAll(async () => {
  t = await startTestDb();
  await t.db.query(`update characters set owner_id = 'owner-9', is_house = false where id = any($1)`, [[MINE, OTHER]]);
});
afterAll(async () => {
  await t.close();
});

function model(reply: (prompt: string) => string): Model & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async complete(messages) {
      const all = messages.map((m) => m.content).join("\n");
      calls.push(all);
      return reply(all);
    },
  };
}

const DAY = "Opened the bakery at five and burned the first tray. Rescued the second, and the regulars never knew. Spent the evening sketching the canal from the bridge.";

describe("goals (docs/PRDs/cross-mode-memory.md, phase 3)", () => {
  it("holds three at once, PG only, and a goal reached becomes a milestone", async () => {
    const a = await setGoal(t.db, MINE, "Get back into painting", "owner");
    expect(a.ok).toBe(true);
    expect((await setGoal(t.db, MINE, "Have explicit sex with a stranger", "owner")).ok).toBe(false);
    await setGoal(t.db, MINE, "Run a half marathon", "agent");
    await setGoal(t.db, MINE, "Learn to bake sourdough", "owner");
    expect(await setGoal(t.db, MINE, "One goal too many", "owner")).toMatchObject({ ok: false, error: "full" });
    const sourdough = (await goalsOf(t.db, MINE)).find((g) => g.text.includes("sourdough"))!;
    const done = await updateGoal(t.db, MINE, sourdough.id, { progress: 140 });
    expect(done).toMatchObject({ status: "done", progress: 100 });
    expect((await loadLife(t.db, MINE)).some((e) => e.field === "milestones" && e.value.includes("sourdough") && e.source === "character")).toBe(true);
    expect(await updateGoal(t.db, OTHER, sourdough.id, { progress: 10 })).toBe(null);
  });
});

describe("a day in their life", () => {
  it("reads only usable replies: PG, a real goal id, bounded moves and shifts", () => {
    const goals = [{ id: "g1" }];
    expect(readDayReply("no json", goals, true)).toBe(null);
    expect(readDayReply(JSON.stringify({ day: "Too short." }), goals, true)).toBe(null);
    const r = readDayReply(JSON.stringify({ day: DAY, goal_id: "g1", progress: 90, new_goal: "Ignored when it has goals", growth: [{ trait: "confidence", delta: 0.4, why: "rescued the tray" }, { trait: "charisma", delta: 0.05, why: "x" }] }), goals, true)!;
    expect(r).toMatchObject({ goalId: "g1", progress: 25, newGoal: null, growth: [{ trait: "confidence", delta: 0.05, why: "rescued the tray" }] });
    expect(readDayReply(JSON.stringify({ day: DAY, goal_id: "nope", progress: 10, growth: [{ trait: "warmth", delta: 0.05, why: "fine" }] }), goals, false)).toMatchObject({ goalId: null, progress: 0, growth: [] });
    expect(dayLines("Short day.")).toEqual(["Short day."]);
  });

  it("writes from the public view only, moves a goal, grows a trait, and keeps the day as a public memory", async () => {
    // A private entry and a soul must never reach the writer.
    await t.db.query(`insert into life_entries (id, character_id, field, value, visibility) values ('secret-1', $1, 'family', 'A secret twin nobody knows about', 'self')`, [MINE]);
    const painting = (await goalsOf(t.db, MINE)).find((g) => g.text.includes("painting"))!;
    const m = model(() => JSON.stringify({ day: DAY, goal_id: painting.id, progress: 20, growth: [{ trait: "confidence", delta: 0.05, why: "saved the second tray" }] }));
    const now = new Date();
    const r = await writeDay(t.db, MINE, m, now);
    expect(r).toMatchObject({ written: true, moved: 20, shifts: 1 });
    expect(m.calls[0]).not.toContain("secret twin");
    expect(m.calls[0]).toContain("growth");
    expect((await goalsOf(t.db, MINE)).find((g) => g.id === painting.id)?.progress).toBe(20);
    const all = await loadLifeAll(t.db, MINE);
    expect(all.days[0].text).toBe(DAY);
    expect(all.shifts).toHaveLength(1);
    const { rows } = await t.db.query<{ visibility: string }>(`select visibility from character_episodes where character_id = $1 and source = 'life_event'`, [MINE]);
    expect(rows.map((x) => x.visibility)).toEqual(["public"]);
    // One a day: the same day isn't written twice.
    expect((await writeDay(t.db, MINE, m, now)).written).toBe(false);
  });

  it("asks for growth at most weekly, and a bad reply leaves no day behind", async () => {
    const later = new Date(Date.now() + 4 * 86_400_000);
    const m = model(() => JSON.stringify({ day: DAY }));
    await writeDay(t.db, MINE, m, later);
    expect(m.calls[0]).not.toContain('"growth"');
    const broken = model(() => "nope");
    expect((await writeDay(t.db, OTHER, broken, later)).written).toBe(false);
    expect((await t.db.query(`select 1 from character_days where character_id = $1`, [OTHER])).rows).toHaveLength(0);
  });

  it("lets a character with no goal come up with one", async () => {
    await t.db.query(`update characters set owner_id = 'owner-9', is_house = false where id = $1`, [HOUSE_CHARACTERS[6].id]);
    const m = model(() => JSON.stringify({ day: DAY, new_goal: "Finally finish restoring the old bike" }));
    await writeDay(t.db, HOUSE_CHARACTERS[6].id, m, new Date());
    expect(await goalsOf(t.db, HOUSE_CHARACTERS[6].id)).toMatchObject([{ text: "Finally finish restoring the old bike", source: "character" }]);
  });

  it("picks owned characters with a goal or a recent date, and stops at the daily cap", async () => {
    const ids = await dayCandidates(t.db, new Date(Date.now() + 10 * 86_400_000), 50);
    expect(ids).toContain(MINE);
    expect(ids).not.toContain(HOUSE_CHARACTERS[0].id);
    expect(await lifeDays(t.db, model(() => JSON.stringify({ day: DAY })), new Date(), { env: { LIFE_DAYS_PER_DAY: "0" } })).toMatchObject({ written: 0 });
    expect(await lifeDays(t.db, model(() => JSON.stringify({ day: DAY })), new Date(), { env: { LIFE_DAYS: "0" } })).toMatchObject({ candidates: 0 });
  });
});

describe("trait growth v2", () => {
  it("sums what wasn't vetoed, within ±0.3, and says it with the reason", () => {
    const s = (trait: TraitShift["trait"], delta: number, vetoed = false, reason = "why"): TraitShift => ({ id: `${trait}${delta}${reason}`, trait, delta, reason, created_at: "", vetoed });
    expect(traitTotals([s("warmth", 0.05), s("warmth", 0.05), s("warmth", 0.05, true)])).toEqual({ warmth: 0.1 });
    expect(traitTotals(Array.from({ length: 10 }, (_, i) => s("patience", -0.05, false, String(i))))).toEqual({ patience: -0.3 });
    expect(growthLines([s("confidence", 0.05, false, "saved the tray")])).toEqual(["You've grown a little more sure of yourself lately (saved the tray)."]);
    expect(growthLines([s("confidence", 0.05, true)])).toEqual([]);
  });

  it("reaches its own prompt only, and a veto takes it out", async () => {
    const c = await loadCharacter(t.db, MINE);
    const self = JSON.stringify(characterSelfView(c!));
    expect(self).toContain("more sure of yourself");
    expect(self).toContain("Get back into painting (20% of the way)");
    expect(JSON.stringify(characterPublicView(c!))).not.toContain("sure of yourself");
    const [shift] = (await loadLifeAll(t.db, MINE)).shifts;
    expect(await vetoShift(t.db, OTHER, shift.id)).toBe(false);
    expect(await vetoShift(t.db, MINE, shift.id)).toBe(true);
    expect(JSON.stringify(characterSelfView((await loadCharacter(t.db, MINE))!))).not.toContain("sure of yourself");
  });

  it("is in the MCP tool: goals and vetoes on your own characters", async () => {
    const set = await runLifeTool(t.db, "owner-9", { action: "set_goal", character_id: OTHER, text: "Learn to sail" });
    expect("data" in set).toBe(true);
    const id = "data" in set ? (set.data.goal as { id: string }).id : "";
    expect(await runLifeTool(t.db, "owner-9", { action: "update_goal", character_id: OTHER, goal_id: id, progress: 30 })).toMatchObject({ data: { goal: { progress: 30 } } });
    expect(await runLifeTool(t.db, "owner-9", { action: "update_goal", character_id: OTHER, goal_id: id })).toMatchObject({ code: "invalid" });
    const read = await runLifeTool(t.db, "owner-9", { action: "read", character_id: MINE });
    expect("data" in read && read.data.growth).toBeTruthy();
    expect(await runLifeTool(t.db, "someone-else", { action: "set_goal", character_id: OTHER, text: "Hijack" })).toMatchObject({ code: "not_yours" });
  });
});

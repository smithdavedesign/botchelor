/**
 * The finale's proposal (lib/season-finale.ts, docs/seasons.md): the seeded rule, a finale that names nobody, the row
 * written once with the freeze, the stage and the notice after it, a wedding only at a later finale, and the switch.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listNotifications } from "@/lib/notifications";
import type { StageDate } from "@/lib/relationship-stages";
import { loadRelationship, pairKey, refreshRelationship, viewRelationship } from "@/lib/relationships";
import type { Ending } from "@/lib/rules";
import { computeFinale, FINALE_RULES, pickFinale, recordFinale, type FinaleCandidate } from "@/lib/season-finale";
import { getSeasonRecap, recapFacts, setSeasonRecapVoiceEnabledForTests } from "@/lib/season-recap";
import { startTestDb } from "./helpers";

const NOVEMBER = "2026-11-01";
const DECEMBER = "2026-12-01";
const NOV_START = "2026-11-01T00:00:00.000Z";
const NOV_CLOSE = "2026-12-01T00:00:00.000Z";

const run = (n: number, last: Ending = "second_date"): StageDate[] =>
  Array.from({ length: n }, (_, i) => ({ ending: i === n - 1 ? last : ("second_date" as const), at: new Date(Date.UTC(2026, 9, 20) + i * 86_400_000).toISOString() }));
const candidate = (lo: string, hi: string, over: Partial<FinaleCandidate> = {}): FinaleCandidate => ({ lo, hi, dates: run(10), season_dates: 2, engaged_at: null, married_at: null, taken: false, ...over });

describe("the rule (pickFinale)", () => {
  it("names nobody when nobody is long-steady: most finales", () => {
    expect(pickFinale([], NOVEMBER, NOV_START)).toEqual({ engaged: null, married: null });
    expect(pickFinale([candidate("a", "b", { dates: run(9) }), candidate("c", "d", { dates: run(4) })], NOVEMBER, NOV_START)).toEqual({ engaged: null, married: null });
  });

  it("engaged: moved in together, seen this season, both free", () => {
    expect(FINALE_RULES).toEqual({ run: 10, dates: 2 });
    expect(pickFinale([candidate("a", "b")], NOVEMBER, NOV_START).engaged).toEqual(["a", "b"]);
    // Not seen enough this season; a run that ended; someone already engaged elsewhere; already engaged themselves.
    expect(pickFinale([candidate("a", "b", { season_dates: 1 })], NOVEMBER, NOV_START).engaged).toBeNull();
    expect(pickFinale([candidate("a", "b", { dates: run(11, "disaster") })], NOVEMBER, NOV_START).engaged).toBeNull();
    expect(pickFinale([candidate("a", "b", { dates: run(11, "friends") })], NOVEMBER, NOV_START).engaged).toBeNull();
    expect(pickFinale([candidate("a", "b", { taken: true })], NOVEMBER, NOV_START).engaged).toBeNull();
    expect(pickFinale([candidate("a", "b", { engaged_at: "2026-11-01T00:00:00.000Z" })], NOVEMBER, NOV_START).engaged).toBeNull();
  });

  it("at most one: the longest run, then the most dates this season, then a draw seeded by the season and the pair", () => {
    const longer = candidate("c", "d", { dates: run(14) });
    expect(pickFinale([candidate("a", "b"), longer, candidate("e", "f", { dates: run(12) })], NOVEMBER, NOV_START).engaged).toEqual(["c", "d"]);
    expect(pickFinale([candidate("a", "b"), candidate("c", "d", { season_dates: 5 })], NOVEMBER, NOV_START).engaged).toEqual(["c", "d"]);
    // A dead heat: the same answer every time for a season, whatever order the candidates come in.
    const tied = [candidate("a", "b"), candidate("c", "d"), candidate("e", "f")];
    const first = pickFinale(tied, NOVEMBER, NOV_START).engaged;
    expect(pickFinale([...tied].reverse(), NOVEMBER, NOV_START).engaged).toEqual(first);
    expect(pickFinale(tied, NOVEMBER, NOV_START).engaged).toEqual(first);
  });

  it("married: engaged at an earlier finale and still engaged, never at the finale that engaged them", () => {
    const engaged = candidate("a", "b", { dates: run(12), engaged_at: NOV_START });
    expect(pickFinale([engaged], NOVEMBER, NOV_START)).toEqual({ engaged: null, married: ["a", "b"] });
    // Their engagement ended in a disaster since: nothing.
    expect(pickFinale([candidate("a", "b", { dates: [...run(10), { ending: "disaster", at: "2026-11-10T00:00:00.000Z" }], engaged_at: NOV_START })], NOVEMBER, NOV_START)).toEqual({ engaged: null, married: null });
    // Already married: nothing more to name.
    expect(pickFinale([candidate("a", "b", { engaged_at: "2026-10-19T00:00:00.000Z", married_at: NOV_START })], NOVEMBER, NOV_START)).toEqual({ engaged: null, married: null });
    // A wedding and a new engagement can share a finale.
    expect(pickFinale([engaged, candidate("c", "d")], NOVEMBER, NOV_START)).toEqual({ engaged: ["c", "d"], married: ["a", "b"] });
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
  setSeasonRecapVoiceEnabledForTests(false);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

let n = 0;
const A = "house-nell";
const B = "house-sable";
async function aired(a: string, b: string, ending: Ending, iso: string) {
  const id = `sf-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup, transcript, created_at)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', $4, $5, 'public', '{"venue":"rooftop_bar"}'::jsonb, '[]'::jsonb, $5)`,
    [id, a, b, ending, iso],
  );
  return id;
}
/** `count` second dates from a day, one a day. */
async function steady(a: string, b: string, count: number, from: string) {
  for (let i = 0; i < count; i++) await aired(a, b, "second_date", new Date(Date.parse(from) + i * 86_400_000).toISOString());
  await refreshRelationship(t.db, a, b);
}
const marks = async () => (await t.db.query<{ lo: string; hi: string; kind: string; layer: string; at: Date }>(`select character_a as lo, character_b as hi, kind, layer, at from relationship_events where kind in ('engaged', 'married') order by id`)).rows;
const shownOf = async (a: string, b: string) => (await loadRelationship(t.db, a, b))!.public.shown;
const AFTER_NOVEMBER = new Date("2026-12-02T12:00:00Z");
const AFTER_DECEMBER = new Date("2027-01-02T12:00:00Z");

describe("a finale with a couple who qualify", () => {
  it("names them engaged in the frozen recap, writes the row once, moves the stage and tells their followers", async () => {
    // Eight second dates in October, two in November: ten in a row, and seen this season.
    await steady(A, B, 8, "2026-10-20T12:00:00Z");
    await steady(A, B, 2, "2026-11-10T12:00:00Z");
    expect(await shownOf(A, B)).toBe("moved_in");
    const [lo, hi] = pairKey(A, B);
    await t.db.query(`insert into couple_follows (user_id, character_lo, character_hi) values ('sf-fan', $1, $2)`, [lo, hi]);

    const recap = await getSeasonRecap(t.db, NOVEMBER, { now: AFTER_NOVEMBER });
    if (recap.status !== "closed") throw new Error("not closed");
    expect(recap.recap.data.finale).toMatchObject({ engaged: { a: { id: lo }, b: { id: hi } }, married: null });
    expect(recapFacts(recap.recap.data)).toContain("At the finale, Nell and Sable got engaged.");
    expect(recap.recap.narrative).toContain("got engaged");

    expect(await marks()).toEqual([{ lo, hi, kind: "engaged", layer: "public", at: new Date(NOV_CLOSE) }]);
    expect(await shownOf(A, B)).toBe("engaged");
    // The rules still read going steady.
    expect((await loadRelationship(t.db, A, B))!.public.stage).toBe("going_steady");
    const view = viewRelationship((await loadRelationship(t.db, A, B))!, { userId: null, owner: false })!;
    expect(view).toMatchObject({ stage: "engaged", stage_label: "💎 Engaged", stage_line: "They got engaged at a season's finale." });
    const heard = (await listNotifications(t.db, "sf-fan")).filter((x) => x.kind === "stage_up");
    expect(heard.map((x) => `${x.title} | ${x.body}`)).toEqual(["Nell & Sable: 💎 Engaged | They got engaged at the season's finale."]);

    // Read again, and recorded again by hand: the stored recap, one row, one notice.
    await getSeasonRecap(t.db, NOVEMBER, { now: AFTER_NOVEMBER });
    expect(await recordFinale(t.db, NOVEMBER, recap.recap.data.finale)).toBe(0);
    expect(await marks()).toHaveLength(1);
    expect((await listNotifications(t.db, "sf-fan")).filter((x) => x.kind === "stage_up")).toHaveLength(1);
  });

  it("the same answer whoever computes it: this finale's own row is never read back as an earlier engagement", async () => {
    await steady(A, B, 8, "2026-10-20T12:00:00Z");
    await steady(A, B, 2, "2026-11-10T12:00:00Z");
    const before = await computeFinale(t.db, NOVEMBER);
    await getSeasonRecap(t.db, NOVEMBER, { now: AFTER_NOVEMBER });
    expect(await computeFinale(t.db, NOVEMBER)).toEqual(before);
    expect(before!.married).toBeNull();
  });

  it("married at a later finale, when they are still engaged and still dating; divorced only by a disaster after it", async () => {
    await steady(A, B, 8, "2026-10-20T12:00:00Z");
    await steady(A, B, 2, "2026-11-10T12:00:00Z");
    await getSeasonRecap(t.db, NOVEMBER, { now: AFTER_NOVEMBER });
    await steady(A, B, 2, "2026-12-05T12:00:00Z");
    expect(await shownOf(A, B)).toBe("engaged");
    const december = await getSeasonRecap(t.db, DECEMBER, { now: AFTER_DECEMBER });
    if (december.status !== "closed") throw new Error("not closed");
    expect(december.recap.data.finale).toMatchObject({ engaged: null, married: { a: { id: pairKey(A, B)[0] } } });
    expect((await marks()).map((m) => m.kind)).toEqual(["engaged", "married"]);
    expect(await shownOf(A, B)).toBe("married");
    // A flat night changes nothing; a disaster is a divorce.
    await aired(A, B, "friends", "2027-01-05T12:00:00Z");
    await refreshRelationship(t.db, A, B);
    expect(await shownOf(A, B)).toBe("married");
    await aired(A, B, "disaster", "2027-01-06T12:00:00Z");
    await refreshRelationship(t.db, A, B);
    expect(await shownOf(A, B)).toBe("divorced");
    expect((await loadRelationship(t.db, A, B))!.public.stage).toBe("exes");
  });

  it("an engagement that ended in a disaster is a breakup, and no wedding follows", async () => {
    await steady(A, B, 8, "2026-10-20T12:00:00Z");
    await steady(A, B, 2, "2026-11-10T12:00:00Z");
    await getSeasonRecap(t.db, NOVEMBER, { now: AFTER_NOVEMBER });
    await aired(A, B, "second_date", "2026-12-05T12:00:00Z");
    await aired(A, B, "disaster", "2026-12-06T12:00:00Z");
    await refreshRelationship(t.db, A, B);
    expect(await shownOf(A, B)).toBe("broke_up");
    const december = await getSeasonRecap(t.db, DECEMBER, { now: AFTER_DECEMBER });
    if (december.status !== "closed") throw new Error("not closed");
    expect(december.recap.data.finale).toEqual({ engaged: null, married: null });
    expect((await marks()).map((m) => m.kind)).toEqual(["engaged"]);
  });
});

describe("a finale with nobody, and the switch", () => {
  it("a long run that the season never saw names nobody: nothing is written, and the facts say nothing", async () => {
    // Fifteen in a row, all in October (as on the live show, 2026-11-16).
    await steady(A, B, 12, "2026-10-19T12:00:00Z");
    const recap = await getSeasonRecap(t.db, NOVEMBER, { now: AFTER_NOVEMBER });
    if (recap.status !== "closed") throw new Error("not closed");
    expect(recap.recap.data.finale ?? { engaged: null, married: null }).toEqual({ engaged: null, married: null });
    expect(recapFacts(recap.recap.data).join(" ")).not.toMatch(/engaged|married/);
    expect(await marks()).toEqual([]);
    expect(await shownOf(A, B)).toBe("moved_in");
  });

  it("a private character's couple is never named", async () => {
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
       values ('sf-private', 'sf-owner', false, 'Wren Lurker', 30, 'Bakes bread and argues with the radio.', '["kind"]'::jsonb, 'someone kind', 'liars', 'private')`,
    );
    await steady(A, "sf-private", 8, "2026-10-20T12:00:00Z");
    await steady(A, "sf-private", 2, "2026-11-10T12:00:00Z");
    expect(await computeFinale(t.db, NOVEMBER)).toEqual({ engaged: null, married: null });
  });

  it("RELATIONSHIP_STAGES_V2=0: no finale names anyone, and a stored mark is not read", async () => {
    await steady(A, B, 8, "2026-10-20T12:00:00Z");
    await steady(A, B, 2, "2026-11-10T12:00:00Z");
    expect(await computeFinale(t.db, NOVEMBER, { RELATIONSHIP_STAGES_V2: "0" })).toBeNull();
    const news = await computeFinale(t.db, NOVEMBER);
    expect(await recordFinale(t.db, NOVEMBER, news, { RELATIONSHIP_STAGES_V2: "0" })).toBe(0);
    expect(await marks()).toEqual([]);
    // With a mark on record and the switch off, the couple reads as the base stage says.
    await recordFinale(t.db, NOVEMBER, news);
    expect(await shownOf(A, B)).toBe("engaged");
    const rel = (await loadRelationship(t.db, A, B))!;
    expect(viewRelationship(rel, { userId: null, owner: false }, new Date(), { RELATIONSHIP_STAGES_V2: "0" })).toMatchObject({ stage: "going_steady", stage_label: "💍 Going steady" });
  });
});

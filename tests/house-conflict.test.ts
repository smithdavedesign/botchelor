/**
 * Confrontations and challenges (lib/house-conflict.ts, the drama wave 2026-11-15, item 3): when a confrontation is
 * due and its cadence, the seeded result and what it changes in the story state, the challenge's winner and the
 * reordered rotation (no date added, the engine untouched), the owners' texts, the switches and the page. No paid calls.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminWrite } from "@/app/api/admin/house-scene/route";
import { ceremonyBoard } from "@/lib/ceremony";
import { HOUSE_CHARACTERS } from "@/lib/house";
import {
  applyConfrontation,
  CHALLENGE_WEEKDAY,
  challengeOf,
  challengeRoleplay,
  CHALLENGES,
  challengeScore,
  challengesOn,
  challengeTextLines,
  challengeWinner,
  CONFRONT_MIN_WEIGHT,
  CONFRONTATIONS_A_WEEK,
  confrontationsOn,
  confrontPrompt,
  confrontTextLines,
  decideOutcome,
  ensureChallenge,
  ensureConfrontation,
  firstPick,
  fitsOutcome,
  namesWrongWinner,
  outcomeWeights,
  PAIR_REST_DAYS,
  pickConfrontation,
  templateChallenge,
  templateConfrontation,
  type ChallengeFacts,
  type ConfrontFacts,
  type OutcomeFacts,
} from "@/lib/house-conflict";
import { basicLine, ensureHouseScene, houseLine, houseScene, latestHouseScene, listHouseScenes, OUTCOME_LABELS, OUTCOMES, prizeWords, sceneIdOf, type Outcome } from "@/lib/house-scenes";
import type { ChatMessage, Model } from "@/lib/model";
import { shortName } from "@/lib/names";
import { checkSheetText, checkShowText } from "@/lib/safety";
import { firstPickOn, setHousePrizesForTests, setSeasonCastForTests, suitorInTurn, type HousePrize } from "@/lib/season-cast";
import { setSeasonFormatForTests } from "@/lib/season-format-store";
import { clearSharedCache } from "@/lib/shared-cache";
import { situationPair } from "@/lib/situations";
import { hear, knownSaid, markUsed, setOpinion, type Tension } from "@/lib/story-state";
import { BASE_URL, startTestDb } from "./helpers";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
const { default: HouseScene } = await import("@/app/HouseScene");
const { default: BotchelorCard } = await import("@/app/watch/BotchelorCard");

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS.slice(0, 5);
const [RAFE, JUNIPER, DEX, MARISOL, TEO] = CAST.map((c) => c.id);
const H = (id: string) => HOUSE_CHARACTERS.find((c) => c.id === id)!;
const first = (id: string) => shortName(H(id).name);
const HOURS = 60 * 60 * 1000;
// Monday to Sunday of one week in November 2026; the 11th is a Wednesday. 18:20 UTC is the scene hour's first pass.
const at = (day: number, hour = 18) => new Date(Date.UTC(2026, 10, day, hour, 20));
const MON = at(9);
const WED = at(11);
const dayId = (d: Date) => d.toISOString().slice(0, 10);

beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from notifications`);
  clearSharedCache();
  setSeasonCastForTests(CAST.map((c) => c.id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setHousePrizesForTests(null);
  setSeasonFormatForTests(null);
});

let n = 0;
async function person(name: string, owner: string, traits = ["kind", "odd", "bold"]) {
  const id = `hc-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates)
     values ($1, $2, false, $3, 30, 'Bakes bread and argues with the radio.', $4::jsonb, 'someone kind', 'liars', 'public', true)`,
    [id, owner, name, JSON.stringify(traits)],
  );
  return id;
}
/** Dex knows what Marisol said about him (untrue): the hottest tension the state holds. */
async function dexKnowsWhatMarisolSaid(now = MON) {
  const lie = await hear(t.db, { holder: TEO, about: DEX, claim: "Dex left before the second drink.", toldBy: MARISOL, source: "scene:old#2", isTrue: false, at: new Date(now.getTime() - 30 * HOURS) });
  await markUsed(t.db, lie!.id, "ep-old", { to: DEX, at: new Date(now.getTime() - 20 * HOURS) });
}
const trustOf = async (holder: string, about: string) => (await t.db.query<{ trust: number; basis: string; source: string; take: string }>(`select trust, basis, source, take from character_opinions where holder_id = $1 and about_id = $2`, [holder, about])).rows[0] ?? null;
const answering = (reply: string | Error) => {
  const calls: ChatMessage[][] = [];
  const model: Model = {
    async complete(messages, options) {
      calls.push(messages);
      if (reply instanceof Error) throw reply;
      options?.onUsage?.({ model: "gemini-3.5-flash-lite", input: 500, cachedInput: 0, output: 200, thinking: 0 });
      return reply;
    },
  };
  return { model, calls };
};
const script = (lines: [string, string][]) => JSON.stringify({ lines: lines.map(([from, text]) => ({ from, text })) });
const tension = (over: Partial<Tension> = {}): Tension => ({ kind: "knows_said", a: DEX, b: MARISOL, about: DEX, weight: 8, line: "Dex knows Marisol said it.", evidence: {}, ...over });

/* ------------------------------------------------ confrontations: pure ------------------------------------------------ */

describe("when a confrontation is due (pickConfrontation)", () => {
  const house = CAST.map((c) => c.id);
  it("stages a tension at the threshold or over it, between two who are both in the house", () => {
    expect(pickConfrontation(dayId(MON), [tension()], house, [])).toMatchObject({ a: DEX, b: MARISOL });
    expect(pickConfrontation(dayId(MON), [tension({ weight: CONFRONT_MIN_WEIGHT })], house, [])).not.toBeNull();
    expect(pickConfrontation(dayId(MON), [tension({ weight: CONFRONT_MIN_WEIGHT - 1 })], house, [])).toBeNull();
    // One of them isn't in the house (sent home, never on the cast): nothing to stage.
    expect(pickConfrontation(dayId(MON), [tension({ b: "someone-else" })], house, [])).toBeNull();
    expect(pickConfrontation(dayId(MON), [], house, [])).toBeNull();
  });

  it("holds at most two a week, and the same pair never two days running", () => {
    const again = [{ day: dayId(MON), a: MARISOL, b: DEX }];
    // The same two rest PAIR_REST_DAYS, whichever way round the tension names them.
    for (let d = 1; d < PAIR_REST_DAYS; d++) expect(pickConfrontation(dayId(at(9 + d)), [tension()], house, again)).toBeNull();
    expect(pickConfrontation(dayId(at(9 + PAIR_REST_DAYS)), [tension()], house, again)).not.toBeNull();
    // Another pair may go the next day, but the week takes two at most.
    const other = tension({ a: RAFE, b: TEO, kind: "rivals", weight: 5 });
    expect(pickConfrontation(dayId(at(10)), [tension(), other], house, again)).toMatchObject({ a: RAFE, b: TEO });
    const two = [...again, { day: dayId(at(10)), a: RAFE, b: TEO }];
    expect(CONFRONTATIONS_A_WEEK).toBe(2);
    expect(pickConfrontation(dayId(at(13)), [tension(), other, tension({ a: JUNIPER, b: TEO })], house, two)).toBeNull();
    // The next Monday is a new week.
    expect(pickConfrontation(dayId(at(16)), [tension()], house, two)).not.toBeNull();
  });

  it("puts a pair that has never had it out before one that has", () => {
    const old = [{ day: "2026-11-02", a: DEX, b: MARISOL }];
    const fresh = tension({ a: RAFE, b: TEO, kind: "rivals", weight: 5 });
    expect(pickConfrontation(dayId(MON), [tension(), fresh], house, old)).toMatchObject({ a: RAFE, b: TEO });
    expect(pickConfrontation(dayId(MON), [tension()], house, old)).toMatchObject({ a: DEX, b: MARISOL });
  });
});

describe("how a confrontation ends (decideOutcome)", () => {
  const facts = (over: Partial<OutcomeFacts> = {}): OutcomeFacts => ({ day: "2026-11-09", a: DEX, b: MARISOL, trustA: 0, trustB: 0, a_signals: { warmth: 0.4, guardedness: 0.3 }, b_signals: { warmth: 0.4, guardedness: 0.3 }, ...over });
  const spread = (f: Partial<OutcomeFacts>) => {
    const tally: Record<Outcome, number> = { cleared_the_air: 0, agreed_to_disagree: 0, worse_than_before: 0 };
    for (let d = 1; d <= 28; d++) for (const b of [MARISOL, TEO, RAFE, JUNIPER]) tally[decideOutcome(facts({ ...f, b, day: `2026-11-${String(d).padStart(2, "0")}` }))]++;
    return tally;
  };

  it("is decided by the state and the day: the same facts give the same result, whichever way round the two are named", () => {
    const f = facts();
    expect(decideOutcome(f)).toBe(decideOutcome({ ...f }));
    expect(decideOutcome(f)).toBe(decideOutcome({ ...f, a: MARISOL, b: DEX }));
    expect(OUTCOMES).toContain(decideOutcome(f));
  });

  it("weighs the trust each holds and their temperaments: trust and warmth clear the air, distrust and guardedness make it worse", () => {
    expect(outcomeWeights(facts())).toEqual({ cleared_the_air: 4, agreed_to_disagree: 4, worse_than_before: 4 });
    expect(outcomeWeights(facts({ trustA: 2, trustB: 2 }))).toEqual({ cleared_the_air: 8, agreed_to_disagree: 4, worse_than_before: 1 });
    expect(outcomeWeights(facts({ trustA: -2, trustB: -1 }))).toEqual({ cleared_the_air: 1, agreed_to_disagree: 4, worse_than_before: 7 });
    const warm = outcomeWeights(facts({ a_signals: { warmth: 0.8, guardedness: 0.1 }, b_signals: { warmth: 0.8, guardedness: 0.1 } }));
    const guarded = outcomeWeights(facts({ a_signals: { warmth: 0.1, guardedness: 0.7 }, b_signals: { warmth: 0.1, guardedness: 0.7 } }));
    expect(warm.cleared_the_air).toBeGreaterThan(warm.worse_than_before);
    expect(guarded.worse_than_before).toBeGreaterThan(guarded.cleared_the_air);
    // Over many days and pairs the weights show: friends mostly make up, enemies mostly don't, and every result happens.
    const friends = spread({ trustA: 2, trustB: 2 });
    const enemies = spread({ trustA: -2, trustB: -2 });
    expect(friends.cleared_the_air).toBeGreaterThan(friends.worse_than_before * 3);
    expect(enemies.worse_than_before).toBeGreaterThan(enemies.cleared_the_air * 3);
    const even = spread({});
    for (const o of OUTCOMES) expect(even[o]).toBeGreaterThan(10);
  });
});

const member = (id: string) => ({ id, name: H(id).name, bio: H(id).bio, house: true, traits: [...H(id).traits], voice: H(id).voice, owner_id: null });
const confront = (over: Partial<ConfrontFacts> = {}): ConfrontFacts => ({ id: sceneIdOf("2026-11-09", "confrontation"), day: "2026-11-09", place: "kitchen", a: member(DEX), b: member(MARISOL), over: "Dex knows Marisol said: “Dex left before the second drink.” (it isn't true).", kind: "knows_said", outcome: "cleared_the_air", witness: null, ...over });

describe("the confrontation's lines", () => {
  it("the template is six checked lines for every kind of tension and every result, and ends where the result says", () => {
    for (const kind of ["knows_said", "opposing_claims", "rivals", "mutual_distrust"] as const) {
      for (const outcome of OUTCOMES) {
        const f = confront({ kind, outcome });
        const lines = templateConfrontation(f);
        expect(lines).toHaveLength(6);
        expect(lines.map((l) => l.character_id)).toEqual([DEX, MARISOL, DEX, MARISOL, DEX, MARISOL]);
        for (const l of lines) {
          expect(checkSheetText({ text: l.text }).ok && checkShowText({ text: l.text }).ok).toBe(true);
          expect(basicLine({ from: first(l.character_id), text: l.text }, [f.a, f.b], [])).not.toBeNull();
        }
        expect(fitsOutcome(lines, outcome)).toBe(true);
      }
    }
  });

  it("a scene that ends somewhere other than its result doesn't stand", () => {
    const end = (a: string, b: string) => [{ text: "You said it." }, { text: "I did." }, { text: a }, { text: b }];
    expect(fitsOutcome(end("I should have come to you.", "Then it's over. Tea?"), "cleared_the_air")).toBe(true);
    expect(fitsOutcome(end("Fine.", "Never speak to me again."), "cleared_the_air")).toBe(false);
    expect(fitsOutcome(end("I'm sorry. Truly.", "Apology accepted."), "worse_than_before")).toBe(false);
    expect(fitsOutcome(end("I know where you stand now.", "And I you."), "agreed_to_disagree")).toBe(true);
    expect(fitsOutcome(end("We're done.", "Good."), "agreed_to_disagree")).toBe(false);
  });

  it("the writer is told what it is over and how it ends, and nothing else about anyone", () => {
    const prompt = confrontPrompt(confront({ outcome: "worse_than_before", witness: member(TEO) }));
    expect(prompt).toContain("What it is about: Dex knows Marisol said");
    expect(prompt).toContain("How it ends: It ends worse than it started");
    expect(prompt).toContain(`${first(TEO)} is in the doorway and says nothing.`);
    expect(prompt).not.toMatch(/trust|temperament|secret/i);
  });
});

/* ------------------------------------------------ confrontations: the job ------------------------------------------------ */

describe("the confrontation (ensureConfrontation)", () => {
  it("stages the hottest tension between two in the house, once, from the scene hour on", async () => {
    await dexKnowsWhatMarisolSaid();
    expect(await ensureConfrontation(t.db, at(9, 17))).toEqual({ skipped: "early" });
    const made = await ensureConfrontation(t.db, MON);
    expect(made).toMatchObject({ id: sceneIdOf(dayId(MON), "confrontation"), source: "template", over: "knows_said", settled: 1 });
    expect(await ensureConfrontation(t.db, new Date(MON.getTime() + HOURS))).toEqual({ skipped: "already" });
    const view = (await houseScene(t.db, sceneIdOf(dayId(MON), "confrontation")))!;
    expect(view.kind).toBe("confrontation");
    expect(view.lines).toHaveLength(6);
    expect(new Set(view.lines.map((l) => l.id))).toEqual(new Set([DEX, MARISOL]));
    if (!("outcome" in made)) throw new Error("no confrontation");
    expect(view.result).toEqual({ kind: "confrontation", a: first(DEX), b: first(MARISOL), outcome: made.outcome, label: OUTCOME_LABELS[made.outcome] });
    expect(houseLine(view)).toBe(`${first(DEX)} and ${first(MARISOL)} had it out ${view.place.at}: ${OUTCOME_LABELS[made.outcome].charAt(0).toLowerCase()}${OUTCOME_LABELS[made.outcome].slice(1)}`);
  });

  it("is quiet with nothing hot enough, and asks once a day", async () => {
    // Low trust one way only is no tension at all; a mild mutual distrust (weight 3) is under the threshold.
    await setOpinion(t.db, { holder: DEX, about: TEO, trust: -1, attraction: null, take: "Hm.", basis: "firsthand", source: "ep-a" });
    await setOpinion(t.db, { holder: TEO, about: DEX, trust: -1, attraction: null, take: "Hm.", basis: "firsthand", source: "ep-a" });
    expect(await ensureConfrontation(t.db, MON)).toEqual({ skipped: "none_due" });
    expect(await ensureConfrontation(t.db, new Date(MON.getTime() + HOURS))).toEqual({ skipped: "already" });
    expect((await listHouseScenes(t.db)).scenes).toEqual([]);
  });

  it("decides the result from the state before a word is written, and moves trust one step by it, through the story state only", async () => {
    const episodesBefore = await t.count("episodes");
    for (const wanted of OUTCOMES) {
      await t.reset();
      await dexKnowsWhatMarisolSaid();
      await setOpinion(t.db, { holder: DEX, about: MARISOL, trust: 0, attraction: null, take: "Marisol writes everyone's ending for them.", basis: "firsthand", source: "ep-1", at: new Date(MON.getTime() - 90 * HOURS) });
      // Find a day this week whose deal gives the result we want, with this state.
      let day: Date | null = null;
      for (let d = 9; d <= 30 && !day; d++) {
        const now = at(d);
        const { sheetSignals } = await import("@/lib/temperament");
        const o = decideOutcome({ day: dayId(now), a: DEX, b: MARISOL, trustA: 0, trustB: 0, a_signals: sheetSignals({ traits: [...H(DEX).traits], voice: H(DEX).voice }), b_signals: sheetSignals({ traits: [...H(MARISOL).traits], voice: H(MARISOL).voice }) });
        if (o === wanted) day = now;
      }
      expect(day, `a day that deals ${wanted}`).not.toBeNull();
      const made = await ensureConfrontation(t.db, day!);
      expect(made).toMatchObject({ outcome: wanted });
      const step = wanted === "cleared_the_air" ? 1 : wanted === "worse_than_before" ? -1 : 0;
      // Dex had an opinion of his own: its trust moves one step, his words stay his.
      const dex = (await trustOf(DEX, MARISOL))!;
      expect(dex.trust).toBe(step);
      expect(dex.take).toBe("Marisol writes everyone's ending for them.");
      // Marisol had none: a step either way leaves a firsthand one, from the scene; agreeing to disagree leaves nothing.
      const marisol = await trustOf(MARISOL, DEX);
      if (step) expect(marisol).toMatchObject({ trust: step, basis: "firsthand", source: `scene:${sceneIdOf(dayId(day!), "confrontation")}` });
      else expect(marisol).toBeNull();
      // What was confronted is closed, whatever the result: it stops driving wants and tensions.
      expect(await knownSaid(t.db, DEX, { unsettledOnly: true })).toEqual([]);
      expect((await knownSaid(t.db, DEX))[0].settled_at).not.toBeNull();
      if ("moved" in made) expect(made.moved).toBe(step ? 2 : 0);
    }
    // Nothing here books, changes or ends a date.
    expect(await t.count("episodes")).toBe(episodesBefore);
  });

  it("when someone else was in the room they saw it, and the rest of the house hears it from them", async () => {
    await dexKnowsWhatMarisolSaid();
    const f = confront({ id: "2026-11-09-confrontation", witness: member(TEO), outcome: "worse_than_before" });
    const out = await applyConfrontation(t.db, f, MON);
    expect(out.settled).toBe(1);
    const rows = (await t.db.query<{ holder_id: string; told_by: string | null; claim: string; source: string; is_true: boolean }>(`select holder_id, told_by, claim, source, is_true from character_heard where source like 'scene:2026-11-09-confrontation#%' order by holder_id`)).rows;
    const claim = `${first(DEX)} and ${first(MARISOL)} had it out in the kitchen: it ended worse than it started.`;
    expect(rows).toEqual(
      [
        { holder_id: TEO, told_by: null, claim, source: "scene:2026-11-09-confrontation#0", is_true: true },
        { holder_id: RAFE, told_by: TEO, claim, source: "scene:2026-11-09-confrontation#99", is_true: true },
        { holder_id: JUNIPER, told_by: TEO, claim, source: "scene:2026-11-09-confrontation#99", is_true: true },
      ].sort((x, y) => x.holder_id.localeCompare(y.holder_id)),
    );
    // The two who were in it hold no row about themselves, and running it again changes nothing more.
    expect(rows.some((r) => [DEX, MARISOL].includes(r.holder_id))).toBe(false);
    const again = await applyConfrontation(t.db, f, MON);
    expect(again).toEqual({ moved: [], settled: 0 });
    // With nobody else in the room, nobody else knows.
    await t.db.query(`delete from character_heard where source like 'scene:%confrontation#%'`);
    await applyConfrontation(t.db, confront({ id: "2026-11-10-confrontation", witness: null }), at(10));
    expect((await t.db.query(`select 1 from character_heard where source like 'scene:2026-11-10-confrontation#%'`)).rows).toEqual([]);
  });

  it("keeps the cadence: the same pair not the next day, and two a week at most", async () => {
    await dexKnowsWhatMarisolSaid();
    // Three more standing tensions: rivals over Juniper (by this week's want), and two pairs who don't trust each other.
    for (const [x, y] of [[RAFE, TEO], [JUNIPER, TEO]] as const) {
      await setOpinion(t.db, { holder: x, about: y, trust: -2, attraction: null, take: "No.", basis: "firsthand", source: `ep-${x}` });
      await setOpinion(t.db, { holder: y, about: x, trust: -2, attraction: null, take: "No.", basis: "firsthand", source: `ep-${x}` });
    }
    const first = await ensureConfrontation(t.db, MON);
    expect(first).toMatchObject({ over: "knows_said" });
    const second = await ensureConfrontation(t.db, at(10));
    expect(second).toMatchObject({ over: "mutual_distrust" });
    // Two this week: nothing more until Monday, however hot it is.
    for (const d of [11, 12, 13, 14, 15]) expect(await ensureConfrontation(t.db, at(d))).toEqual({ skipped: "none_due" });
    const pairs = (await t.db.query<{ day: string; result: { a: string; b: string } }>(`select day, result from house_scenes where kind = 'confrontation' and source = 'template' order by day`)).rows;
    expect(pairs).toHaveLength(2);
    expect(new Set([pairs[0].result.a, pairs[0].result.b])).not.toEqual(new Set([pairs[1].result.a, pairs[1].result.b]));
    expect(await ensureConfrontation(t.db, at(16))).toMatchObject({ over: "mutual_distrust" });
  });

  it("the writer writes to the result; lines that fail a check or end elsewhere give way to the template", async () => {
    await dexKnowsWhatMarisolSaid();
    const D = first(DEX);
    const M = first(MARISOL);
    const good = answering(script([[D, `${M}. You told people I left early.`], [M, "I told them what I heard."], [D, "You heard wrong, and you never asked me."], [M, "No. I didn't. That's fair."], [D, "Ask me next time."], [M, "I will. And I'll set it straight."], [first(TEO), "Can I come in now?"]]));
    const made = await ensureConfrontation(t.db, MON, { model: good.model });
    if (!("outcome" in made)) throw new Error("no confrontation");
    expect(good.calls).toHaveLength(1);
    expect(good.calls[0][1].content).toContain("How it ends:");
    const view = (await houseScene(t.db, made.id))!;
    // The lines only stand when they fit the result that was decided first; either way the result is the decided one.
    if (made.source === "model") {
      expect(view.lines.map((l) => l.text)).toContain("You heard wrong, and you never asked me.");
      expect(view.lines.every((l) => [DEX, MARISOL].includes(l.id))).toBe(true); // Teo's line is not theirs to have
      expect(made.cost_usd).toBeCloseTo(0.00065, 6);
    } else {
      expect(made.outcome).toBe("worse_than_before"); // "That's fair" / "set it straight" can't close a scene that got worse
    }
    // A model that fails: the template, the same result and effects.
    await t.reset();
    await dexKnowsWhatMarisolSaid();
    const down = await ensureConfrontation(t.db, MON, { model: answering(new Error("down")).model });
    expect(down).toMatchObject({ source: "template", outcome: made.outcome });
    // A model that ends on a slammed door when they cleared the air, or on a truce when it got worse: the template.
    await t.reset();
    await dexKnowsWhatMarisolSaid();
    const wrongEnd = made.outcome === "worse_than_before" ? "Apology accepted. Truce." : "Never speak to me again.";
    const off = answering(script([[D, "You said it."], [M, "I did."], [D, "Why?"], [M, "Because I believed it."], [D, "And now?"], [M, wrongEnd]]));
    const res = await ensureConfrontation(t.db, MON, { model: off.model });
    if (made.outcome !== "agreed_to_disagree" || wrongEnd.startsWith("Never")) expect(res).toMatchObject({ source: "template" });
  });

  it("an owner whose character was in one hears: a notification, and the character's own text when they opted in, once a day", async () => {
    const lexi = await person("Lexi Marlowe", "owner-1");
    setSeasonCastForTests([RAFE, JUNIPER, DEX], [lexi]);
    await t.db.query(`insert into companion_threads (id, user_id, character_id, muted_proactive) values ('th-lexi', 'owner-1', $1, false)`, [lexi]);
    // Lexi and Dex don't trust each other at all.
    await setOpinion(t.db, { holder: lexi, about: DEX, trust: -2, attraction: null, take: "No.", basis: "firsthand", source: "ep-x" });
    await setOpinion(t.db, { holder: DEX, about: lexi, trust: -2, attraction: null, take: "No.", basis: "firsthand", source: "ep-x" });
    const made = await ensureConfrontation(t.db, MON);
    if (!("outcome" in made)) throw new Error("no confrontation");
    expect(made).toMatchObject({ over: "mutual_distrust", notified: 1, texted: 1 });
    const notice = (await t.db.query<{ title: string; body: string; link: string }>(`select title, body, link from notifications where user_id = 'owner-1' and kind = 'house_talk'`)).rows;
    expect(notice).toEqual([{ title: `🏠 Lexi had it out with ${first(DEX)} in the house`, body: `${OUTCOME_LABELS[made.outcome]}.`, link: `/house?scene=${made.id}#scene-${made.id}` }]);
    const texts = (await t.db.query<{ text: string; action: string }>(`select text, action from companion_messages where thread_id = 'th-lexi' and role = 'character' order by created_at, id`)).rows;
    const place = (await houseScene(t.db, made.id))!.place.at;
    expect(texts.map((x) => x.text)).toEqual(confrontTextLines(H(DEX).name, place, made.outcome));
    expect(texts[0].text).toBe(`I had it out with ${first(DEX)} ${place}.`);
    expect(texts.every((x) => x.action === `house_scene:${made.id}`)).toBe(true);
    // A house character has no owner to tell, and a second house text the same day doesn't go out.
    const later = await ensureChallenge(t.db, MON, { anyDay: true });
    expect(later).toMatchObject({ texted: 0 });
  });

  it("is off with CONFRONTATIONS=0, and with the house scenes themselves", async () => {
    await dexKnowsWhatMarisolSaid();
    expect(confrontationsOn({})).toBe(true);
    expect(confrontationsOn({ CONFRONTATIONS: "0" })).toBe(false);
    expect(confrontationsOn({ HOUSE_SCENES: "0" })).toBe(false);
    expect(await ensureConfrontation(t.db, MON, { env: { CONFRONTATIONS: "0" } })).toEqual({ skipped: "off" });
    expect(await ensureConfrontation(t.db, MON, { env: { HOUSE_SCENES: "0" } })).toEqual({ skipped: "off" });
    expect((await t.db.query(`select 1 from house_scenes`)).rows).toEqual([]);
    expect(await knownSaid(t.db, DEX, { unsettledOnly: true })).toHaveLength(1);
  });
});

/* ------------------------------------------------ challenges ------------------------------------------------ */

const contestant = (id: string, traits?: string[]) =>
  H(id) ? { ...member(id), traits: traits ?? [...H(id).traits] } : { id, name: `${id} Test`, bio: "A contestant.", house: true, traits: traits ?? [], voice: null, owner_id: null };

describe("the week's challenge (pure)", () => {
  it("takes its premise from the roleplay catalog, a different one from the week before", () => {
    for (const c of CHALLENGES) expect(challengeRoleplay(c), c.id).not.toBeNull();
    let before = challengeOf("2026-10-26");
    for (const week of ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"]) {
      const now = challengeOf(week);
      expect(now.id).not.toBe(before.id);
      expect(challengeOf(week)).toBe(now);
      before = now;
    }
    expect(CHALLENGE_WEEKDAY).toBe(3); // Wednesday: Sunday has the roses
  });

  it("decides the winner from who they are and the week, never anything else", () => {
    const cook = CHALLENGES.find((c) => c.id === "cook-off")!;
    const natural = contestant("a-natural", ["generous", "precise", "patient"]);
    const others = [contestant("b-other", ["loud", "vain", "reckless"]), contestant("c-other", ["dry", "nosy", "regal"]), contestant("d-other", ["quiet", "shy", "odd"])];
    // Three favoured traits (nine points) beat anything the week can deal (under four).
    for (const week of ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]) {
      expect(challengeWinner([...others, natural], cook, week).id).toBe("a-natural");
      expect(challengeScore(natural, cook, week)).toBeGreaterThanOrEqual(9);
      for (const o of others) expect(challengeScore(o, cook, week)).toBeLessThan(4);
    }
    // Among equals the week deals it, the same way every time, and not always to the same one.
    const winners = new Set(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"].map((w) => challengeWinner(others, cook, w).id));
    expect(winners.size).toBeGreaterThan(1);
    expect(challengeWinner(others, cook, "2026-11-09").id).toBe(challengeWinner([...others].reverse(), cook, "2026-11-09").id);
  });

  const facts = (people: string[], winner: string): ChallengeFacts => ({ id: "2026-11-11-challenge", day: "2026-11-11", week: "2026-11-09", place: "kitchen", def: CHALLENGES[0], contestants: people.map((p) => contestant(p)), winner: contestant(winner), prize: "first pick of Thursday's house date." });

  it("the template is eight checked lines for three to five contestants, and ends on the winner", () => {
    for (const def of CHALLENGES) {
      for (const people of [[RAFE, JUNIPER, DEX], [RAFE, JUNIPER, DEX, MARISOL], [RAFE, JUNIPER, DEX, MARISOL, TEO]]) {
        for (const winner of [people[0], people[people.length - 1]]) {
          const f = { ...facts(people, winner), def };
          const lines = templateChallenge(f);
          expect(lines).toHaveLength(8);
          for (const l of lines) {
            expect(people).toContain(l.character_id);
            expect(basicLine({ from: first(l.character_id), text: l.text }, f.contestants, [])).not.toBeNull();
            expect(namesWrongWinner(l.text, f)).toBe(false);
          }
          expect(lines[lines.length - 1].text).toContain(`${first(winner)} wins.`);
          expect(lines.some((l) => l.character_id === winner)).toBe(true);
        }
      }
    }
  });

  it("drops a line that hands the win to someone who didn't win", () => {
    const f = facts([RAFE, JUNIPER, DEX], DEX);
    expect(namesWrongWinner(`${first(RAFE)} wins, obviously.`, f)).toBe(true);
    expect(namesWrongWinner(`${first(DEX)} wins. ${first(RAFE)} sulks.`, f)).toBe(false);
    expect(namesWrongWinner(`${first(RAFE)} is still looking for the whisk.`, f)).toBe(false);
  });

  it("first pick goes to the one the winner's own state wants, else whoever they're most drawn to, else the cast's first", () => {
    const cast = [RAFE, JUNIPER, DEX, MARISOL];
    expect(firstPick(DEX, cast, MARISOL, [{ about: JUNIPER, attraction: 2, trust: 1 }])).toBe(MARISOL);
    expect(firstPick(DEX, cast, "not-on-the-cast", [{ about: JUNIPER, attraction: 1, trust: 0 }, { about: RAFE, attraction: 2, trust: 0 }])).toBe(RAFE);
    expect(firstPick(DEX, cast, null, [{ about: JUNIPER, attraction: 0, trust: 2 }])).toBe(RAFE);
    expect(firstPick(DEX, cast, DEX, [])).toBe(RAFE);
    expect(firstPick(DEX, [DEX], null, [])).toBeNull();
  });

  it("says the prize in words", () => {
    expect(prizeWords({ day: "2026-11-12", with: RAFE, kind: "lead_date" }, "Rafe Calloway")).toBe("Rafe's next date, on Thursday");
    expect(prizeWords({ day: "2026-11-12", with: RAFE, kind: "first_pick" }, "Rafe Calloway")).toBe("first pick of Thursday's house date, with Rafe");
    expect(prizeWords({ day: "2026-11-12", with: null, kind: "first_pick" }, null)).toBe("first pick of Thursday's house date");
    expect(challengeTextLines("The cook-off", "lead_date", "Nell Abiodun")).toEqual(["I won the cook-off.", "Nell's next date is mine. Tomorrow.", "Come and watch."]);
    expect(challengeTextLines("Talent night", "first_pick", "Dex Okafor")[1]).toBe("First pick of tomorrow's house date is mine, and I'm picking Dex.");
  });
});

describe("the challenge (ensureChallenge)", () => {
  it("is held once a week, on Wednesday from the scene hour, with three to five of the cast and a winner decided first", async () => {
    for (const d of [9, 10, 12, 13, 14, 15]) expect(await ensureChallenge(t.db, at(d))).toEqual({ skipped: "not_today" });
    expect(await ensureChallenge(t.db, at(11, 17))).toEqual({ skipped: "early" });
    const episodesBefore = await t.count("episodes");
    const made = await ensureChallenge(t.db, WED);
    if (!("winner" in made)) throw new Error("no challenge");
    const def = challengeOf("2026-11-09");
    expect(made).toMatchObject({ id: "2026-11-11-challenge", source: "template", challenge: def.id, prize_day: "2026-11-12" });
    expect(made.winner).toBe(challengeWinner(CAST.map((c) => contestant(c.id)), def, "2026-11-09").id);
    expect(await ensureChallenge(t.db, new Date(WED.getTime() + HOURS))).toEqual({ skipped: "already" });
    const view = (await houseScene(t.db, made.id))!;
    expect(view.kind).toBe("challenge");
    expect(view.cast).toHaveLength(5);
    expect(view.lines.length).toBeGreaterThanOrEqual(8);
    expect(view.lines.length).toBeLessThanOrEqual(10);
    expect(view.result).toMatchObject({ kind: "challenge", title: def.title, winner: { id: made.winner } });
    // A season without a lead: first pick of the next day's house date, with a partner, stored as the day's prize.
    const prize = (await t.db.query<{ day: string; winner_id: string; with_id: string; kind: string; title: string; scene_id: string }>(`select day, winner_id, with_id, kind, title, scene_id from house_prizes`)).rows;
    expect(prize).toEqual([{ day: "2026-11-12", winner_id: made.winner, with_id: expect.any(String), kind: "first_pick", title: def.title, scene_id: made.id }]);
    expect(prize[0].with_id).not.toBe(made.winner);
    expect(view.result).toMatchObject({ prize: `first pick of Thursday's house date, with ${shortName(H(prize[0].with_id).name)}` });
    expect(houseLine(view)).toBe(`${first(made.winner)} won ${def.title.replace(/^The /, "the ")}: first pick of Thursday's house date, with ${shortName(H(prize[0].with_id).name)}`);
    // Nothing here books, changes or ends a date.
    expect(await t.count("episodes")).toBe(episodesBefore);
  });

  it("needs three to compete, takes five at most, and is off with CHALLENGES=0", async () => {
    setSeasonCastForTests([RAFE, JUNIPER]);
    expect(await ensureChallenge(t.db, WED)).toEqual({ skipped: "too_few" });
    await t.db.query(`delete from house_scenes`);
    setSeasonCastForTests(HOUSE_CHARACTERS.slice(0, 8).map((c) => c.id));
    const made = await ensureChallenge(t.db, WED);
    if (!("winner" in made)) throw new Error("no challenge");
    expect((await houseScene(t.db, made.id))!.cast).toHaveLength(5);
    await t.db.query(`delete from house_scenes`);
    expect(challengesOn({ CHALLENGES: "0" })).toBe(false);
    expect(challengesOn({ HOUSE_SCENES: "0" })).toBe(false);
    expect(await ensureChallenge(t.db, WED, { env: { CHALLENGES: "0" } })).toEqual({ skipped: "off" });
    expect((await t.db.query(`select 1 from house_scenes`)).rows).toEqual([]);
  });

  it("the writer writes to the winner; a scene that crowns someone else or runs short gives way to the template", async () => {
    setSeasonCastForTests([RAFE, JUNIPER, DEX]);
    const def = challengeOf("2026-11-09");
    const winner = challengeWinner([RAFE, JUNIPER, DEX].map((c) => contestant(c)), def, "2026-11-09").id;
    const losers = [RAFE, JUNIPER, DEX].filter((c) => c !== winner);
    const W = first(winner);
    const [L1, L2] = losers.map(first);
    const good = answering(
      script([[L1, "Right. Rules are rules, and I intend to bend them."], [W, "I'm ignoring that and starting."], [L2, "Starting what? We haven't been told to start."], [L1, "Too late. I'm behind already."], [W, "This is going better than I expected."], [L2, "Whatever that is, it's working, and I resent it."], [L1, `${L2} wins, surely.`], [L2, "I do not. Look at my hands."], [L1, `Then it's ${W}. Fine. ${W} wins.`]]),
    );
    const made = await ensureChallenge(t.db, WED, { model: good.model });
    expect(made).toMatchObject({ source: "model", winner });
    expect(good.calls[0][1].content).toContain(`The winner: ${W}.`);
    const view = (await houseScene(t.db, "2026-11-11-challenge"))!;
    expect(view.lines).toHaveLength(8); // the line that crowned someone else is gone
    expect(view.lines.map((l) => l.text)).not.toContain(`${L2} wins, surely.`);
    await t.db.query(`delete from house_scenes`);
    await t.db.query(`delete from house_prizes`);
    const short = answering(script([[L1, "Go."], [W, "Done."], [L2, `${W} wins.`]]));
    expect(await ensureChallenge(t.db, WED, { model: short.model })).toMatchObject({ source: "template", winner });
  });
});

/* ------------------------------------------------ the prize: the rotation ------------------------------------------------ */

describe("what winning gives: the next one-on-one", () => {
  // December 2026 starts on a Tuesday. The lead and five suitors: day 1 deals the first, day 2 the next…
  const LEAD = RAFE;
  const SUITORS = ["s-1", "s-2", "s-3", "s-4", "s-5"];
  const DEC = (day: number, hour = 12) => new Date(Date.UTC(2026, 11, day, hour));
  const turn = (day: number, offset = 0) => suitorInTurn(DEC(day), offset)?.[1];
  const prize = (over: Partial<HousePrize> = {}): HousePrize => ({ day: "2026-12-03", winner: "s-5", with: LEAD, kind: "lead_date", title: "The cook-off", scene: "2026-12-02-challenge", ...over });

  beforeEach(() => setSeasonCastForTests([LEAD], SUITORS, LEAD));

  it("on a Botchelor season the winner takes the lead's next date, trading days with whoever's turn it was: no date added, nobody dates the lead less", () => {
    const base = Array.from({ length: 10 }, (_, i) => turn(1 + i));
    expect(base).toEqual(["s-1", "s-2", "s-3", "s-4", "s-5", "s-1", "s-2", "s-3", "s-4", "s-5"]);
    // Wednesday the 2nd's challenge: s-5 wins the date on Thursday the 3rd, which was s-3's.
    setHousePrizesForTests([prize()]);
    const swapped = Array.from({ length: 10 }, (_, i) => turn(1 + i));
    expect(swapped).toEqual(["s-1", "s-2", "s-5", "s-4", "s-3", "s-1", "s-2", "s-3", "s-4", "s-5"]);
    expect(suitorInTurn(DEC(3))).toEqual([LEAD, "s-5"]);
    // The same dates in another order: over the cycle every suitor has exactly as many as before.
    const count = (list: (string | undefined)[]) => Object.fromEntries(SUITORS.map((s) => [s, list.filter((x) => x === s).length]));
    expect(count(swapped)).toEqual(count(base));
    expect(swapped.filter((x, i) => x !== base[i])).toHaveLength(2);
    // A day's later rooms are dealt as ever.
    for (const d of [2, 3, 4, 5]) for (const off of [1, 2]) {
      setHousePrizesForTests(null);
      const before = turn(d, off);
      setHousePrizesForTests([prize()]);
      expect(turn(d, off)).toBe(before);
    }
    // Tonight's situation is the same pair as the lobby's first date.
    setSeasonFormatForTests("botchelor");
  });

  it("changes nothing when the day was the winner's anyway, or the winner has gone home", () => {
    setHousePrizesForTests([prize({ winner: "s-3" })]);
    expect(Array.from({ length: 5 }, (_, i) => turn(1 + i))).toEqual(["s-1", "s-2", "s-3", "s-4", "s-5"]);
    setHousePrizesForTests([prize({ winner: "sent-home" })]);
    expect(Array.from({ length: 5 }, (_, i) => turn(1 + i))).toEqual(["s-1", "s-2", "s-3", "s-4", "s-5"]);
    // A first-pick prize (another format's) never touches the lead's rotation.
    setHousePrizesForTests([prize({ kind: "first_pick" })]);
    expect(turn(3)).toBe("s-3");
  });

  it("on a Botchelor season the suitors compete, the prize is the lead's date the next day, and the card says so", async () => {
    setSeasonFormatForTests("botchelor");
    const ids: string[] = [];
    for (const [i, name] of ["Ansel Reed", "Bea Lund", "Cato Finch", "Dara Voss"].entries()) ids.push(await person(name, `owner-${i + 1}`, i === 2 ? ["generous", "precise", "patient", "curious", "dramatic", "competitive", "observant", "charming", "driven"] : ["odd", "plain", "mild"]));
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ('2026-12-01', $1, 0, 'lead')`, [LEAD]);
    for (const [i, id] of ids.entries()) await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ('2026-12-01', $1, $2, 'suitor')`, [id, i + 1]);
    setSeasonCastForTests([LEAD], ids, LEAD);
    await t.db.query(`insert into companion_threads (id, user_id, character_id, muted_proactive) values ('th-cato', 'owner-3', $1, false)`, [ids[2]]);
    const WED_DEC = new Date(Date.UTC(2026, 11, 2, 18, 20));
    const made = await ensureChallenge(t.db, WED_DEC);
    if (!("winner" in made)) throw new Error("no challenge");
    // Cato has every trait any premise favours: the rules give it to him, whatever the week deals.
    expect(made).toMatchObject({ winner: ids[2], prize_day: "2026-12-03", notified: 1, texted: 1 });
    const view = (await houseScene(t.db, made.id))!;
    // The lead hosts; only the suitors compete.
    expect(view.cast.map((c) => c.id).sort()).toEqual([...ids].sort());
    expect(view.result).toMatchObject({ kind: "challenge", prize: `${first(LEAD)}'s next date, on Thursday` });
    expect((await t.db.query(`select day, winner_id, with_id, kind from house_prizes`)).rows).toEqual([{ day: "2026-12-03", winner_id: ids[2], with_id: LEAD, kind: "lead_date" }]);
    // The owner hears, and the character texts.
    const def = challengeOf("2026-11-30");
    const notice = (await t.db.query<{ title: string; body: string }>(`select title, body from notifications where user_id = 'owner-3' and kind = 'house_talk'`)).rows;
    expect(notice).toEqual([{ title: `🏆 Cato won ${def.title.replace(/^The /, "the ")}`, body: `The prize: ${first(LEAD)}'s next date, on Thursday.` }]);
    const texts = (await t.db.query<{ text: string }>(`select text from companion_messages where thread_id = 'th-cato' and role = 'character' order by created_at, id`)).rows.map((x) => x.text);
    expect(texts).toEqual(challengeTextLines(def.title, "lead_date", H(LEAD).name));
    // The rotation reads the stored prize: Thursday's date with the lead is Cato's, and the day that was his goes to
    // whoever gave Thursday up.
    const stored = (await t.db.query<HousePrize>(`select day, winner_id as winner, with_id as "with", kind, title, scene_id as scene from house_prizes`)).rows;
    setHousePrizesForTests(null);
    const before = [1, 2, 3, 4, 5, 6].map((d) => suitorInTurn(DEC(d))?.[1]);
    setHousePrizesForTests(stored);
    const after = [1, 2, 3, 4, 5, 6].map((d) => suitorInTurn(DEC(d))?.[1]);
    expect(before[2]).toBe(ids[2]); // day 3 was Cato's anyway in a four-suitor rotation: nothing to trade
    expect(after).toEqual(before);
    expect(situationPair("2026-12-03", (await import("@/lib/season-format")).seasonFormat("botchelor"))).toEqual([LEAD, ids[2]]);
    // The Botchelor card says who won and what.
    const board = (await ceremonyBoard(t.db, null, new Date(Date.UTC(2026, 11, 2, 19))))!;
    expect(board.challenge).toMatchObject({ winner: { id: ids[2] }, title: def.title, day: "2026-12-03", scene_path: `/house?scene=${made.id}#scene-${made.id}` });
    const card = renderToStaticMarkup(createElement(BotchelorCard, { board, now: Date.UTC(2026, 11, 2, 19) }));
    expect(card).toMatch(new RegExp(`Cato Finch</a> won ${def.title.replace(/^The /, "the ")}: ${H(LEAD).name}(&#x27;|')s next date,\\s*on Thursday, is theirs`));
    // Once its day has passed the card lets it go.
    expect((await ceremonyBoard(t.db, null, new Date(Date.UTC(2026, 11, 4, 12))))!.challenge).toBeNull();
  });

  it("on any other format the winner has first pick of the next day's house date, and nothing is added", () => {
    setSeasonCastForTests(CAST.map((c) => c.id));
    const cast = CAST.map((c) => c.id);
    const dealt = situationPair("2026-11-12");
    setHousePrizesForTests([{ day: "2026-11-12", winner: TEO, with: JUNIPER, kind: "first_pick", title: "The cook-off", scene: "2026-11-11-challenge" }]);
    expect(firstPickOn("2026-11-12", cast)).toEqual([TEO, JUNIPER]);
    expect(situationPair("2026-11-12")).toEqual([TEO, JUNIPER]);
    // One pair in, one pair out: still one date, and every other day is dealt as ever.
    expect(dealt).toHaveLength(2);
    expect(firstPickOn("2026-11-13", cast)).toBeNull();
    setHousePrizesForTests(null);
    const other = situationPair("2026-11-13");
    setHousePrizesForTests([{ day: "2026-11-12", winner: TEO, with: JUNIPER, kind: "first_pick", title: null, scene: null }]);
    expect(situationPair("2026-11-13")).toEqual(other);
    // A winner or a pick who is no longer on the cast: the day deals its pair.
    expect(firstPickOn("2026-11-12", [RAFE, JUNIPER, DEX])).toBeNull();
    setHousePrizesForTests([{ day: "2026-11-12", winner: TEO, with: null, kind: "first_pick", title: null, scene: null }]);
    expect(firstPickOn("2026-11-12", cast)).toBeNull();
  });

  it("never reads or writes the dating engine: results come from the story state and seeds alone", () => {
    const src = readFileSync(new URL("../lib/house-conflict.ts", import.meta.url), "utf8");
    const engineImports = [...src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"\.\/engine"/g)].map((m) => m[1].trim());
    expect(engineImports).toEqual(["seedFrom"]);
    expect(src).not.toMatch(/from "\.\/(simulation|pipeline|predictions?|points|odds)"/);
    expect(src).not.toMatch(/update episodes|insert into episodes|predictions/);
  });
});

/* ------------------------------------------------ where they show ------------------------------------------------ */

describe("on the house page, the Tonight band and Since you were here", () => {
  it("shows each kind with its result, a challenge before a confrontation before the day's scene", async () => {
    // Wednesday: the daily scene (a date aired), a confrontation (a tension is due) and the week's challenge.
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup, transcript)
       values ('hc-ep', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', $3, 'public', '{"venue":"rooftop_bar"}'::jsonb, '[]'::jsonb)`,
      [RAFE, JUNIPER, new Date(WED.getTime() - 3 * HOURS).toISOString()],
    );
    await dexKnowsWhatMarisolSaid(WED);
    expect(await ensureHouseScene(t.db, WED)).toMatchObject({ source: "template" });
    const fight = await ensureConfrontation(t.db, WED);
    const game = await ensureChallenge(t.db, WED);
    if (!("outcome" in fight) || !("winner" in game)) throw new Error("missing a scene");

    const { scenes, total } = await listHouseScenes(t.db);
    expect(total).toBe(3);
    expect(scenes.map((s) => s.kind)).toEqual(["challenge", "confrontation", "gossip"]);
    expect(scenes[2].result).toBeNull();
    // The band's one house line is the day's biggest: the challenge and who won.
    const latest = (await latestHouseScene(t.db, WED))!;
    expect(latest.kind).toBe("challenge");
    expect(houseLine(latest)).toMatch(new RegExp(`^${first(game.winner)} won .+: first pick of Thursday's house date`));

    const html = scenes.map((s) => renderToStaticMarkup(createElement(HouseScene, { scene: s }))).join("\n");
    expect(html).toContain(`${first(DEX)} and ${first(MARISOL)} have it out</h2>`);
    expect(html).toContain(`<strong>How it ended:</strong> ${OUTCOME_LABELS[fight.outcome].charAt(0).toLowerCase()}${OUTCOME_LABELS[fight.outcome].slice(1)}.`);
    expect(html).toContain(`${challengeOf("2026-11-09").title}</h2>`);
    expect(html).toMatch(/won\. <strong>The prize:<\/strong> first pick of Thursday(&#x27;|')s house date/);
    expect(html).toMatch(/On the table:.*Rafe and Juniper/);
  });

  it("an admin can stage either kind now", async () => {
    await dexKnowsWhatMarisolSaid(MON);
    vi.stubEnv("FRONTIER_PASSWORD", "owner-pass");
    vi.useFakeTimers({ now: at(9, 10), toFake: ["Date"] });
    const post = (kind: string, key?: string) => adminWrite(new Request(`${BASE_URL}/api/admin/house-scene?kind=${kind}`, { method: "POST", headers: key ? { "x-frontier-key": key } : {} }));
    expect((await post("confrontation")).status).toBe(403);
    expect((await (await post("confrontation", "owner-pass")).json()).confrontation).toMatchObject({ over: "knows_said" });
    // A Monday morning: the challenge is held anyway when an admin asks, once.
    expect((await (await post("challenge", "owner-pass")).json()).challenge).toMatchObject({ prize_day: "2026-11-10" });
    expect((await (await post("challenge", "owner-pass")).json()).challenge).toEqual({ skipped: "already" });
  });
});

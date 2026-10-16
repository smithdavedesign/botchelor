import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deterministicEngine, type DateInput, type SideOutcome } from "@/lib/engine";
import {
  computeRelationship,
  loadRelationship,
  pairContext,
  pairKey,
  stageOf,
  tieStrength,
  venueForPlan,
  viewRelationship,
  type RelEpisode,
} from "@/lib/relationships";
import { getReunion } from "@/lib/reunion";
import { api, HOUSE_PARTNER_ID, setupEpisode, startTestDb } from "./helpers";

const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null });
const arc = (final: number) => ({ start: 50, delta: final - 50, final });
const [LO, HI] = pairKey("char-cass", "char-ira"); // "char-cass" < "char-ira"

/** One date between Cass (lo) and Ira (hi). `aIs` says who sat on side a. */
function ep(id: string, day: number, over: Partial<RelEpisode> = {}, aIs: "lo" | "hi" = "lo"): RelEpisode {
  return {
    id,
    created_at: new Date(Date.UTC(2026, 9, day)).toISOString(),
    revealed_at: new Date(Date.UTC(2026, 9, day, 12)).toISOString(),
    visibility: "public",
    hidden: false,
    creator_id: "user-1",
    character_a: aIs === "lo" ? LO : HI,
    character_b: aIs === "lo" ? HI : LO,
    ending: "second_date",
    sides: [side(true), side(true)],
    box_score: { chemistry: arc(70), trust: arc(60) },
    transcript: [],
    afterglow: [],
    venue: "rooftop_bar",
    followup_of: null,
    ...over,
  };
}

describe("the relationship graph — stages and tie strength", () => {
  it("climbs sparks → dating → going steady on second dates in a row, and remembers how it ended", () => {
    expect(stageOf([])).toBeNull();
    expect(stageOf(["second_date"])).toBe("sparks");
    expect(stageOf(["second_date", "second_date"])).toBe("dating");
    expect(stageOf(["second_date", "second_date", "second_date", "second_date"])).toBe("going_steady");
    expect(stageOf(["friends"])).toBe("just_met");
    expect(stageOf(["second_date", "friends"])).toBe("friends");
    expect(stageOf(["second_date", "disaster"])).toBe("exes");
    expect(stageOf(["disaster"])).toBe("bad_blood");
  });

  it("a tie is stronger the more often, the more recently, the warmer and the more mutual they meet", () => {
    const now = new Date("2026-10-16T00:00:00Z");
    const base = { dates: 2, second_dates: 1, mutual_yes: 1, chemistry: 60, last_at: "2026-10-15T00:00:00Z" };
    const t = tieStrength(base, now);
    expect(tieStrength({ ...base, dates: 6, mutual_yes: 3 }, now)).toBeGreaterThan(t);
    expect(tieStrength({ ...base, chemistry: 90 }, now)).toBeGreaterThan(t);
    expect(tieStrength({ ...base, mutual_yes: 0 }, now)).toBeLessThan(t);
    expect(tieStrength(base, new Date("2026-12-16T00:00:00Z"))).toBeLessThan(t); // two months on, it has faded
    expect(tieStrength({ ...base, dates: 0 }, now)).toBe(0);
  });
});

describe("the relationship graph — what they learn about each other", () => {
  const first = ep("d1", 10, {
    transcript: [
      { side: "a", act: 0, dialogue: "I'm a cartographer, I spend my weekends redrawing bus maps nobody asked for.", action: "", emotion: "", interest: 0.8 },
      { side: "b", act: 0, dialogue: "My studio is above a bakery, so everything I make smells like sugar packets.", action: "", emotion: "", interest: 0.7 },
      { side: "a", act: 1, dialogue: "Sugar packets as a building material? Tell me more.", action: "", emotion: "", interest: 0.6 },
      { side: "b", act: 1, dialogue: "Do you always ask this many questions?", action: "", emotion: "", interest: 0.5 },
      { side: "a", act: 2, dialogue: "Only about sugar packets.", action: "", emotion: "", interest: 0.9 },
    ],
    afterglow: [
      { side: "a", text: "Still thinking about the sugar packets. That was a good night." },
      { side: "b", text: "Coffee works. Bring the anthology story and I'll bring dried apricots." },
      { side: "a", text: "You're on. Tuesday?" },
    ],
  });

  it("keeps what each of them said about themselves (not their questions), about the right person", () => {
    const rel = computeRelationship(LO, HI, [first], ["Cass Vega", "Ira Fenn"]);
    expect(rel.facts.find((f) => f.text.startsWith("I'm a cartographer"))?.about).toBe("lo");
    expect(rel.facts.find((f) => f.text.startsWith("My studio"))?.about).toBe("hi");
    expect(rel.facts.some((f) => f.text.includes("Do you always ask"))).toBe(false);
  });

  it("finds inside jokes: a phrase both said that comes back in the texts", () => {
    const rel = computeRelationship(LO, HI, [first], ["Cass Vega", "Ira Fenn"]);
    expect(rel.jokes.map((j) => j.phrase)).toContain("sugar packets");
  });

  it("keeps the plans from the morning-after texts, and marks one kept when the next date picks it up", () => {
    const open = computeRelationship(LO, HI, [first]);
    const plan = open.plans.find((p) => p.by === "hi")!;
    expect(plan.text).toMatch(/Coffee works/);
    expect(plan.status).toBe("open");
    expect(venueForPlan([plan])).toBe("corner_cafe");
    expect(venueForPlan([{ text: "Same time next week?" }])).toBeNull();

    const second = ep("d2", 12, {
      followup_of: "d1",
      transcript: [{ side: "b", act: 0, dialogue: "As promised: the anthology story, and the dried apricots.", action: "", emotion: "", interest: 0.9 }],
    }, "hi");
    const later = computeRelationship(LO, HI, [second, first]); // any order in
    expect(later.plans.find((p) => p.by === "hi")).toMatchObject({ status: "kept", kept_in: "d2" });
    expect(later.history.map((h) => h.episode_id)).toEqual(["d1", "d2"]);
    expect(later.history[1].followup_of).toBe("d1");
  });

  it("maps each side's wish for another date to the right person, whichever side they sat on", () => {
    const flipped = ep("d3", 14, { sides: [side(true), side(false)] }, "hi"); // Ira on side a wants more, Cass doesn't
    const rel = computeRelationship(LO, HI, [flipped]);
    expect(rel.history[0].wants).toEqual([false, true]); // [lo = Cass, hi = Ira]
    expect(rel.all.mutual_yes).toBe(0);
  });

  it("runs chemistry and trust across their dates, the newest weighing most", () => {
    const rel = computeRelationship(LO, HI, [
      ep("d1", 1, { box_score: { chemistry: arc(40), trust: arc(40) } }),
      ep("d2", 2, { box_score: { chemistry: arc(80), trust: arc(60) } }),
    ]);
    expect(rel.all.chemistry).toBe(60);
    expect(rel.all.trust).toBe(50);
  });
});

describe("the relationship graph — who sees what", () => {
  const dates = [
    ep("pub", 1, { creator_id: "user-1" }),
    ep("unaired", 2, { creator_id: "user-1", revealed_at: null, ending: "disaster" }),
    ep("private", 3, { creator_id: "user-2", visibility: "private" }),
    ep("hidden", 4, { creator_id: "user-1", hidden: true }),
  ];
  const rel = computeRelationship(LO, HI, dates);

  it("the public layer reads only dates that aired publicly and weren't hidden: no spoiler, no private date", () => {
    expect(rel.all.dates).toBe(4);
    expect(rel.public.dates).toBe(1);
    expect(rel.public.last_ending).toBe("second_date"); // not the unaired disaster
    expect(rel.public.mutual_yes).toBe(0); // each side's wish is private
  });

  it("a spectator sees the public dates; an owner also sees their own, never another owner's private date", () => {
    const spectator = viewRelationship(rel, { userId: "someone", owner: false })!;
    expect(spectator.timeline.map((t) => t.episode_id)).toEqual(["pub"]);
    expect(spectator.plans).toBeUndefined();
    expect(spectator.mutual_yes).toBeUndefined();

    const owner1 = viewRelationship(rel, { userId: "user-1", owner: true })!;
    expect(owner1.timeline.map((t) => t.episode_id)).toEqual(["pub", "unaired", "hidden"]);
    expect(owner1.plans).toEqual([]);

    const owner2 = viewRelationship(rel, { userId: "user-2", owner: true })!;
    expect(owner2.timeline.map((t) => t.episode_id)).toEqual(["pub", "private"]);
  });

  it("a character brings into a date only the public record and the dates of whoever set this one up", () => {
    const ctx = pairContext(rel, LO, "user-2", null)!;
    expect(ctx.times_together).toBe(2); // pub + user-2's private date
    expect(pairContext(rel, LO, "", null)!.times_together).toBe(1); // a house room: public only
  });

  it("tonight's plan is in the prompt only on the second date it was made for", () => {
    const withPlan = computeRelationship(LO, HI, [
      ep("d1", 1, { afterglow: [{ side: "b", text: "Coffee works. Bring the anthology story." }] }),
    ]);
    expect(pairContext(withPlan, LO, "user-1", "d1")!.tonight_is_the_plan_you_made).toEqual(["They: “Coffee works. Bring the anthology story.”"]);
    expect(pairContext(withPlan, LO, "user-1", null)!.tonight_is_the_plan_you_made).toBeUndefined();
  });
});

describe("the engine reads the running relationship", () => {
  const sheet = (name: string) => ({ name, age: 30, bio: "A person.", traits: ["warm"], want: "kindness", dealbreaker: "rudeness", house: false });
  const sideSetup = (name: string) => ({
    sheet: sheet(name), signals: { warmth: 0.5, openness: 0.5, guardedness: 0.5, humor: 0.5 }, autonomy: "balanced" as const,
    strategy: "genuine_chemistry" as const, agendaId: "keep_it_light" as const, note: null, gameBudget: 25 as const,
  });
  const input = (history?: DateInput["history"]): DateInput => ({ a: sideSetup("A"), b: sideSetup("B"), history });

  it("a warm history starts the night warmer than a cold one; without it a date decides exactly as before", () => {
    const warm = deterministicEngine.decide(input({ dates: 2, last_ending: "second_date", chemistry: 90, trust: 85 }), 7);
    const cold = deterministicEngine.decide(input({ dates: 2, last_ending: "second_date", chemistry: 15, trust: 20 }), 7);
    expect(warm.variables.chemistry.final).toBeGreaterThan(cold.variables.chemistry.final);
    expect(warm.variables.trust.final).toBeGreaterThan(cold.variables.trust.final);
    // No running state (a date decided before the graph): the old last-ending rule, unchanged.
    expect(deterministicEngine.decide(input({ dates: 2, last_ending: "second_date" }), 7)).toEqual(
      deterministicEngine.decide(input({ dates: 2, last_ending: "second_date", chemistry: undefined }), 7),
    );
  });
});

describe("the relationship graph — stored and refreshed", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it("an edge appears with the date, joins the public layer when it airs, and leaves it when made private", async () => {
    const { creator, character, episode } = await setupEpisode("second_date");
    let rel = (await loadRelationship(t.db, character.id, HOUSE_PARTNER_ID))!;
    expect(rel.all.dates).toBe(1);
    expect(rel.public.dates).toBe(0); // not aired: no spoiler
    expect((await getReunion(t.db)).couples).toHaveLength(0);

    await api.reveal(episode.id, creator);
    rel = (await loadRelationship(t.db, character.id, HOUSE_PARTNER_ID))!;
    expect(rel.public.dates).toBe(1);
    expect(rel.public.stage).toBe("sparks");
    expect((await getReunion(t.db)).couples).toHaveLength(1);

    await api.setVisibility(episode.id, "private", creator);
    rel = (await loadRelationship(t.db, character.id, HOUSE_PARTNER_ID))!;
    expect(rel.all.dates).toBe(1);
    expect(rel.public.dates).toBe(0);
  });

  it("a rematch snapshots the pair's history on its setup, so a replay sees the relationship as it was", async () => {
    const { creator, character, episode } = await setupEpisode("second_date");
    await api.reveal(episode.id, creator);
    const { scriptOutcome, scriptedModel, episodeJson } = await import("./helpers");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const second = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    const stored = (await t.db.query<{ setup: { history?: { dates: number; last_ending: string } } }>(`select setup from episodes where id = $1`, [second.id])).rows[0];
    expect(stored.setup.history).toMatchObject({ dates: 1, last_ending: "second_date" });
  });
});

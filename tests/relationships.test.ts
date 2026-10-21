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
import { assembleDate, DEFAULT_DATE_REQUEST } from "@/lib/simulation";
import { evalCharacter } from "@/lib/eval";
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

  // From the 2026-10-17 paid simulation: whole lines with a question in the middle were kept as facts, and filler
  // both said ("i'll bring", "checking") was kept as an inside joke.
  it("keeps only the self-disclosing sentences of a line, never the question asked with them", () => {
    const d = ep("q1", 10, {
      transcript: [
        { side: "a", act: 0, dialogue: "Okay, I'm not moving. Is staying still the right call with bees, or do they take it personally?", action: "", emotion: "", interest: 0.9 },
        { side: "b", act: 0, dialogue: "Hives, mostly. I'm out there most mornings checking frames and pulling honey. Have you ever been stung?", action: "", emotion: "", interest: 0.8 },
      ],
    });
    const rel = computeRelationship(LO, HI, [d], ["Mira Quell", "Emrys Pine"]);
    expect(rel.facts.map((f) => f.text)).toEqual(["I'm out there most mornings checking frames and pulling honey."]);
  });

  it("doesn't count contractions or filler words as inside jokes", () => {
    const d1 = ep("j1", 10, {
      transcript: [
        { side: "a", act: 0, dialogue: "I'll bring the map, I was checking the hive three frames honestly.", action: "", emotion: "", interest: 0.5 },
        { side: "b", act: 0, dialogue: "I'll bring gloves then. I was checking hive three too, honestly.", action: "", emotion: "", interest: 0.5 },
      ],
      afterglow: [{ side: "a", text: "I'll bring the map. Still checking on hive three, honestly." }],
    });
    const phrases = computeRelationship(LO, HI, [d1], ["Mira Quell", "Emrys Pine"]).jokes.map((j) => j.phrase);
    expect(phrases).toContain("hive three");
    expect(phrases).not.toContain("i'll bring");
    expect(phrases).not.toContain("checking");
    expect(phrases).not.toContain("honestly");
  });

  it("keeps a possessive inside joke (\"sponge's fault\"), not a contraction", () => {
    const d1 = ep("j2", 10, {
      transcript: [
        { side: "a", act: 0, dialogue: "The dry edges? That's the sponge's fault, not mine.", action: "", emotion: "", interest: 0.5 },
        { side: "b", act: 0, dialogue: "Fine, the sponge's fault. It's always the sponge.", action: "", emotion: "", interest: 0.5 },
      ],
      afterglow: [{ side: "b", text: "Still blaming it on the sponge's fault this morning." }],
    });
    const phrases = computeRelationship(LO, HI, [d1], ["Pike Alderman", "Pernilla Krause"]).jokes.map((j) => j.phrase);
    expect(phrases).toContain("sponge's fault");
    expect(phrases.some((p) => p.includes("it's") || p.includes("that's"))).toBe(false);
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

  it("a plan settled by text after the morning after wins over it, for the date before the texts", () => {
    const at = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
    const texts = [
      { who: "hi" as const, text: "Can't wait to see you Friday. Let's get coffee.", at: at(9, 12) }, // before their first date: a match's chat
      { who: "hi" as const, text: "Actually, let's do the botanic park on Thursday instead.", at: at(10, 20) },
      { who: "hi" as const, text: "Deal.", at: at(10, 21) }, // a bare yes doesn't replace the plan it confirms
      { who: "lo" as const, text: "Thursday then. The 12:03 platform, front carriage.", at: at(10, 22) },
    ];
    const rel = computeRelationship(LO, HI, [first], ["", ""], texts);
    expect(rel.plans.find((p) => p.by === "hi")).toMatchObject({ text: "Actually, let's do the botanic park on Thursday instead.", episode_id: "d1", status: "open" });
    expect(rel.plans.find((p) => p.by === "lo")).toMatchObject({ text: "Thursday then. The 12:03 platform, front carriage.", episode_id: "d1" });
    expect(venueForPlan(rel.plans.filter((p) => p.episode_id === "d1"))).toBe("botanic_park");
    // Without the texts, the morning after's plan stands; texts after a later date belong to that one.
    expect(computeRelationship(LO, HI, [first]).plans.find((p) => p.by === "hi")!.text).toMatch(/Coffee works/);
    const second = ep("d2", 12, { transcript: [{ side: "a", act: 0, dialogue: "The botanic park, as promised, on a Thursday.", action: "", emotion: "", interest: 0.8 }] });
    const both = computeRelationship(LO, HI, [first, second], ["", ""], [...texts, { who: "lo", text: "Next time: karaoke, and I'm choosing the duet.", at: at(12, 20) }]);
    expect(both.plans.find((p) => p.episode_id === "d1" && p.by === "hi")).toMatchObject({ status: "kept", kept_in: "d2" });
    expect(both.plans.find((p) => p.episode_id === "d2")).toMatchObject({ by: "lo", text: /karaoke/ });
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

  it("a spectator sees the public dates; an owner sees all the pair's dates, never another owner's private date", () => {
    const spectator = viewRelationship(rel, { userId: "someone", owner: false })!;
    expect(spectator.timeline.map((t) => t.episode_id)).toEqual(["pub"]);
    expect(spectator.plans).toBeUndefined();
    expect(spectator.mutual_yes).toBeUndefined();

    const owner1 = viewRelationship(rel, { userId: "user-1", owner: true })!;
    expect(owner1.timeline.map((t) => t.episode_id)).toEqual(["pub", "unaired", "hidden"]);
    expect(owner1.plans).toEqual([]);

    // The other owner doesn't wait for user-1 to air a date, but user-1 never sees user-2's private one.
    const owner2 = viewRelationship(rel, { userId: "user-2", owner: true })!;
    expect(owner2.timeline.map((t) => t.episode_id)).toEqual(["pub", "unaired", "private", "hidden"]);
  });

  it("second_dates counts the endings and second_dates_had the follow-up dates that took place (#520)", () => {
    const first = ep("first", 1);
    const second = ep("second", 3, { followup_of: "first" });
    const view = viewRelationship(computeRelationship(LO, HI, [first, second]), { userId: "someone", owner: false })!;
    expect(view.dates).toBe(2);
    expect(view.second_dates).toBe(2);
    expect(view.second_dates_had).toBe(1);
  });

  it("an edge stored before dates carried a private flag treats them as private to the other owner", () => {
    const legacy = { ...rel, history: rel.history.map(({ private: _p, ...h }) => h) };
    const owner2 = viewRelationship(legacy, { userId: "user-2", owner: true })!;
    expect(owner2.timeline.map((t) => t.episode_id)).toEqual(["pub", "private"]);
  });

  it("tells the timeline what happened next: friends for now, then another date", () => {
    const chain = computeRelationship(LO, HI, [
      ep("d1", 1, { ending: "friends" }),
      ep("d2", 2, { followup_of: "d1", ending: "second_date" }),
      ep("d3", 3, { followup_of: "d2", ending: "friends" }),
    ]);
    const view = viewRelationship(chain, { userId: "user-1", owner: true })!;
    expect(view.timeline.map((t) => t.ending_label)).toEqual(["Friends, for now", "Another date", "Just friends"]);
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

  it("a couple's box score starts where they left off; a first date starts from the blind-date baseline", () => {
    const first = deterministicEngine.decide(input(), 7);
    expect(first.variables.chemistry.start).toBe(50);
    expect(first.variables.trust.start).toBe(45);

    const again = deterministicEngine.decide(input({ dates: 4, last_ending: "second_date", chemistry: 72.6, trust: 56.3 }), 7);
    expect(again.variables.chemistry.start).toBe(73);
    expect(again.variables.trust.start).toBe(56);
    for (const v of ["chemistry", "trust"] as const) {
      expect(again.variables[v].delta).toBe(again.variables[v].final - again.variables[v].start);
    }
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

describe("a planned venue doesn't trap a couple", () => {
  // From the 2026-10-17 paid simulation: a running joke about thermos tea put every one of a couple's five dates in
  // the same corner café, because each morning-after plan mentioned tea.
  const a = evalCharacter("house-rafe");
  const b = evalCharacter("house-juniper");
  const teaPlan = [{ side: "b" as const, text: "Same café tomorrow? I'll bring the tea, you bring the verdict." }];
  const build = (eps: RelEpisode[], followupOf: string) => {
    const [x, y] = [a.forDate.id, b.forDate.id];
    const rel = computeRelationship(x < y ? x : y, x < y ? y : x, eps.map((e) => ({ ...e, character_a: x, character_b: y })));
    return assembleDate({
      episodeId: "next", a: a.forDate, b: b.forDate, req: DEFAULT_DATE_REQUEST, seed: 4,
      soulA: a.soul, soulB: b.soul, memoryA: null, memoryB: null, history: undefined,
      relationship: rel, creatorId: "user-1", followupOf,
    }).setup.venue;
  };

  it("goes where they planned, but never to the same place twice in a row (Cass and Dex, 2026-10-18)", () => {
    expect(build([ep("c1", 1, { venue: "rooftop_bar", afterglow: teaPlan })], "c1")).toBe("corner_cafe");
    expect(build([ep("c1", 1, { venue: "corner_cafe", afterglow: teaPlan })], "c1")).not.toBe("corner_cafe");
  });

  it("goes somewhere new when their last two dates were both at the planned place", () => {
    const eps = [ep("c1", 1, { venue: "corner_cafe" }), ep("c2", 2, { venue: "corner_cafe", followup_of: "c1", afterglow: teaPlan })];
    expect(build(eps, "c2")).not.toBe("corner_cafe");
  });
});

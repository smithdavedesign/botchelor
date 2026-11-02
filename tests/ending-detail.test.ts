/**
 * More endings (David 2026-11-01, docs/date-quality.md "Round: more endings"): one-sided, a slow burn, a walk-out,
 * ghosted and rivals, each a kind of one of the three endings (episodes.ending stays the family; ending_detail says
 * which kind). Predictions score on the family. No paid calls: scripted models only.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetTouchesForTests } from "@/lib/activity";
import { simulateAfterglow } from "@/lib/afterglow";
import { assembleCharacter, type Character } from "@/lib/character";
import { setChoicesAskedForTests } from "@/lib/choices";
import { simulateConversation } from "@/lib/conversation";
import { endingDetail, ghostSide, GHOST_SHARE, walkOutSide, WALK_OUT_SHARE } from "@/lib/ending-detail";
import { deterministicEngine, fixedEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type Outcome, type SideOutcome, type SideSetup } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import type { ChatMessage, Model } from "@/lib/model";
import { listNotifications } from "@/lib/notifications";
import { generateDate } from "@/lib/pipeline";
import { AFTERGLOW_TURNS, CONVERSATION_TURNS, ENDING_DETAIL_FAMILY, ENDING_DETAILS, endingDetailOf, endingWithDetail } from "@/lib/rules";
import type { StoredSoul } from "@/lib/souls";
import { pickVenue } from "@/lib/venues";
import { sampleDates } from "./engine-sample";
import { api, episodeJson, newUserCookie, planJson, setupEpisode, startTestDb, userIdOf } from "./helpers";

const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm"], want: "a map reader", dealbreaker: "hates surprises", house: false };
const sheetB: CharacterSheet = { name: "Rafe", age: 30, bio: "a baker", traits: ["dramatic", "kind"], want: "an honest taste-tester", dealbreaker: "liars", house: true };
const side = (sheet: CharacterSheet): SideSetup => ({ sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_adventurous", note: null, gameBudget: 25 });
const INPUT: DateInput = { a: side(sheetA), b: side(sheetB) };
const soul = (): StoredSoul => ({ values: "honesty", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false, signals: null });
const CHARS: [Character, Character] = [
  assembleCharacter({ id: "mira-oc", sheet: sheetA, soul: soul(), memory: null }),
  assembleCharacter({ id: "rafe-house", sheet: sheetB, soul: soul(), memory: null }),
];
const so = (wants: boolean, extra: Partial<SideOutcome> = {}): SideOutcome => ({ wants_another: wants, agenda_met: false, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null, ...extra });
const userText = (m: ChatMessage[]) => m.filter((x) => x.role === "user").map((x) => x.content).join("\n");
const line = (dialogue: string, extra: Record<string, unknown> = {}) => JSON.stringify({ dialogue, action: "", emotion: "flat", interest_signal: 0.3, ...extra });
const lines = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => line(`Line ${i}: so what is it you actually do with a ${["map", "loaf", "ferry", "kite"][i % 4]}?`, extra(i)));
function recording(outputs: string[]): Model & { seen: ChatMessage[][] } {
  const q = [...outputs];
  const seen: ChatMessage[][] = [];
  return { seen, async complete(m) { seen.push(m); const n = q.shift(); if (n === undefined) throw new Error("out of outputs"); return n; } };
}
/** A disaster's seed whose walk-out goes to `who` (walkOutSide). */
const walkSeed = (who: "a" | "b", sides: [SideOutcome, SideOutcome]) => {
  for (let s = 1; s < 5000; s++) if (walkOutSide({ ending: "disaster", seed: s, sides }) === who) return s;
  throw new Error("no seed");
};

describe("the kinds and their family", () => {
  it("each kind belongs to a family, and one on the wrong ending reads as none", () => {
    for (const k of ENDING_DETAILS) expect(ENDING_DETAIL_FAMILY[k].length).toBeGreaterThan(0);
    expect(ENDING_DETAIL_FAMILY.slow_burn).toEqual(["friends"]);
    expect(ENDING_DETAIL_FAMILY.walked_out).toEqual(["disaster"]);
    expect(Object.values(ENDING_DETAIL_FAMILY).some((f) => f.includes("second_date"))).toBe(false);
    expect(endingDetailOf("slow_burn", "friends")).toBe("slow_burn");
    expect(endingDetailOf("slow_burn", "disaster")).toBeNull();
    expect(endingDetailOf("teleported", "friends")).toBeNull();
    expect(endingWithDetail("friends", null, "slow_burn")).toBe("Just friends · A slow burn");
    expect(endingWithDetail("disaster", null, "walked_out")).toBe("A disaster · A walk-out");
    expect(endingWithDetail("second_date", 3, "ghosted")).toBe("A fourth date");
  });

  it("the walk-out is offered on about half of disasters, to the side it went worse for, never on another ending", () => {
    const sample = sampleDates(2000, 1103).map(({ input, seed }) => deterministicEngine.decide(input, seed, 5));
    const disasters = sample.filter((o) => o.ending === "disaster");
    const offered = disasters.filter((o) => walkOutSide(o)).length / disasters.length;
    expect(Math.abs(offered - WALK_OUT_SHARE)).toBeLessThan(0.08);
    expect(sample.filter((o) => o.ending !== "disaster").every((o) => walkOutSide(o) === null)).toBe(true);
    const hit = [so(false, { dealbreaker_hit: "liars" }), so(false)] as [SideOutcome, SideOutcome];
    const seed = walkSeed("a", hit);
    expect(walkOutSide({ ending: "disaster", seed, sides: hit })).toBe("a");
    expect(walkOutSide({ ending: "disaster", seed, sides: hit })).toBe("a"); // the same every time
  });

  it("ghosting: the side that said no, against a yes or a maybe, on about half of those", () => {
    const seeds = Array.from({ length: 2000 }, (_, i) => i * 7919 + 3);
    const share = seeds.filter((s) => ghostSide({ a: "yes", b: "no" }, s) === "b").length / seeds.length;
    expect(Math.abs(share - GHOST_SHARE)).toBeLessThan(0.05);
    expect(seeds.every((s) => ghostSide({ a: "no", b: "no" }, s) === null)).toBe(true);
    expect(seeds.every((s) => ghostSide({ a: "yes", b: "maybe" }, s) === null)).toBe(true);
    expect(seeds.some((s) => ghostSide({ a: "no", b: "maybe" }, s) === "a")).toBe(true);
    expect(ghostSide(null, 1)).toBeNull();
  });

  it("which kind: walk-out, ghosted, rivals, slow burn, one-sided, in that order", () => {
    const names = ["Mira", "Rafe"] as const;
    const t = (s: "a" | "b", feeling?: string, extra = {}) => ({ side: s, ...(feeling ? { inner: { feeling: feeling as never } } : {}), ...extra });
    const plain = [t("a"), t("b"), t("a"), t("b")];
    expect(endingDetail({ ending: "disaster", transcript: [...plain, t("a", undefined, { walked_out: true })], names })).toBe("walked_out");
    expect(endingDetail({ ending: "friends", transcript: [...plain, t("a", undefined, { walked_out: true })], names })).toBeNull(); // the answers lifted it
    expect(endingDetail({ ending: "friends", choices: { a: "yes", b: "no" }, ghost: "b", transcript: plain, names })).toBe("ghosted");
    expect(endingDetail({ ending: "friends", choices: { a: "yes", b: "no" }, transcript: plain, names })).toBe("one_sided");
    const sparring = [t("a", "competitive"), t("b", "competitive"), t("a", "competitive"), t("b", "competitive")];
    expect(endingDetail({ ending: "disaster", choices: { a: "maybe", b: "no" }, transcript: sparring, names })).toBe("rivals");
    expect(endingDetail({ ending: "second_date", choices: { a: "yes", b: "yes" }, transcript: sparring, names })).toBeNull();
    const planned = [
      { side: "a" as const, text: "Last night was fun. How about the observatory next?" },
      { side: "b" as const, text: "I'm in. The observatory it is." },
    ];
    expect(endingDetail({ ending: "friends", choices: { a: "maybe", b: "yes" }, transcript: plain, afterglow: planned, names })).toBe("slow_burn");
    expect(endingDetail({ ending: "friends", choices: { a: "maybe", b: "yes" }, transcript: plain, afterglow: [], names })).toBeNull();
    expect(endingDetail({ ending: "friends", choices: { a: "maybe", b: "yes" }, transcript: plain, afterglow: null, names })).toBeNull();
    expect(endingDetail({ ending: "disaster", choices: { a: "maybe", b: "yes" }, transcript: plain, afterglow: planned, names })).toBeNull();
  });
});

describe("a walk-out on the date", () => {
  const disaster = (sides: [SideOutcome, SideOutcome]): Outcome => fixedEngine({ ending: "disaster", sides }).decide(INPUT, walkSeed("a", sides));
  const hit = [so(false, { dealbreaker_hit: "liars" }), so(false)] as [SideOutcome, SideOutcome];

  it("only the side offered it, in the closing stretch of a disaster, and the date ends on that line", async () => {
    const outcome = disaster(hit);
    const model = recording(lines(CONVERSATION_TURNS, () => ({ walk_out: true })));
    const t = await simulateConversation(model, INPUT, outcome, CHARS, "a_hard_question", pickVenue(1), undefined, undefined, undefined, undefined, undefined, undefined, { walkOut: "a" });
    const at = t.findIndex((x) => x.walked_out);
    expect(at).toBeGreaterThan(0);
    expect(t[at].side).toBe("a");
    expect(t).toHaveLength(at + 1);
    expect(t.slice(0, at).some((x) => x.walked_out)).toBe(false); // not before the closing stretch
    // The offer is in that side's data only.
    const offered = model.seen.filter((m) => userText(m).includes("you_can_walk_out"));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((m) => userText(m).includes('"you":{"name":"Mira'))).toBe(true);
  });

  it("isn't honoured where it wasn't offered", async () => {
    const t = await simulateConversation(recording(lines(CONVERSATION_TURNS, () => ({ walk_out: true }))), INPUT, disaster(hit), CHARS, "a_hard_question", pickVenue(1));
    expect(t.some((x) => x.walked_out)).toBe(false);
    const friends = fixedEngine({ ending: "friends", sides: hit }).decide(INPUT, 5);
    const f = await simulateConversation(recording(lines(CONVERSATION_TURNS, () => ({ walk_out: true }))), INPUT, friends, CHARS, "a_hard_question", pickVenue(1), undefined, undefined, undefined, undefined, undefined, undefined, { walkOut: "a" });
    expect(f.some((x) => x.walked_out)).toBe(false);
  });
});

describe("ghosted: the morning after goes unanswered", () => {
  it("the silent side never texts, and the other is told it's had no reply", async () => {
    const model = recording(Array.from({ length: AFTERGLOW_TURNS }, (_, i) => JSON.stringify({ text: `Morning text ${i}, about the ferry and the kite.` })));
    const outcome = fixedEngine({ ending: "friends", sides: [so(true), so(false)] }).decide(INPUT, 3);
    const thread = await simulateAfterglow(model, INPUT, outcome, CHARS, "rooftop_bar", "classic", AFTERGLOW_TURNS, {}, [], undefined, "b");
    expect(thread.length).toBe(Math.ceil(AFTERGLOW_TURNS / 2));
    expect(thread.every((t) => t.side === "a")).toBe(true);
    expect(userText(model.seen[0])).not.toContain("they_havent_replied");
    expect(userText(model.seen[1])).toContain("they_havent_replied");
  });
});

describe("a show date under v5", () => {
  afterEach(() => setChoicesAskedForTests(false));

  it("one yes and one no: one-sided, or ghosted with the afterglow left unanswered, the same way every replay", async () => {
    setChoicesAskedForTests(true);
    const built = buildEvalDate(EVAL_CASES.find((x) => x.id === "mira-dex")!);
    const run = async (seed: number) => {
      const b = { ...built, seed };
      const decided = fixedEngine({ ending: "friends" }, { wishes: true }).decide(b.input, seed);
      const director = recording([planJson(), episodeJson()]);
      const date = lines(CONVERSATION_TURNS);
      let texts = 0;
      const actor: Model = {
        async complete(messages) {
          const sys = messages[0].content;
          if (sys.includes("Would you see them again?")) return userText(messages).includes(`"you":{"name":"${b.characters[0].name}`) ? '{"see_again":"yes","reason":"I want more."}' : '{"see_again":"no","reason":"Not for me."}';
          if (sys.includes("the morning after a date")) return JSON.stringify({ text: `Text ${texts++}: thanks for the evening and the bread.` });
          const n = date.shift();
          if (!n) throw new Error("out of lines");
          return n;
        },
      };
      return generateDate({ actor, director }, b, decided, { formatId: "classic", formatCtx: {}, conversation: true, afterglow: true, reflection: false, wishes: true, engineVersion: 5 });
    };
    const ghostly = Array.from({ length: 200 }, (_, i) => i + 1).find((s) => ghostSide({ a: "yes", b: "no" }, s) === "b")!;
    const plain = Array.from({ length: 200 }, (_, i) => i + 1).find((s) => ghostSide({ a: "yes", b: "no" }, s) === null)!;
    const g = await run(ghostly);
    expect(g.wishes?.choices).toEqual({ a: "yes", b: "no" });
    expect(g.outcome.ending).toBe("friends");
    expect(g.endingDetail).toBe("ghosted");
    expect(g.afterglow.length).toBeGreaterThan(0);
    expect(g.afterglow.every((t) => t.side === "a")).toBe(true);
    const p = await run(plain);
    expect(p.endingDetail).toBe("one_sided");
    expect(p.afterglow.some((t) => t.side === "b")).toBe(true);
  });

  it("before v5, no kind", async () => {
    const built = buildEvalDate(EVAL_CASES.find((x) => x.id === "mira-dex")!);
    const decided = fixedEngine({ ending: "friends" }).decide(built.input, built.seed);
    const gen = await generateDate({ actor: recording(lines(CONVERSATION_TURNS)), director: recording([planJson(), episodeJson()]) }, built, decided, {
      formatId: "classic", formatCtx: {}, conversation: true, afterglow: false, reflection: false, wishes: true, engineVersion: 4,
    });
    expect(gen.endingDetail).toBeNull();
  });
});

describe("on the page, the feed and the notices", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    forgetTouchesForTests();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the kind with the ending once it airs, and a pick on the family still scores", async () => {
    const { creator, episode } = await setupEpisode("friends");
    await t.db.query(`update episodes set ending_detail = 'slow_burn', visibility = 'public' where id = $1`, [episode.id]);
    const viewer = newUserCookie();
    expect((await api.predict({ episode_id: episode.id, pick: "friends" }, viewer)).status).toBe(201);
    const before = await (await api.getEpisode(episode.id)).json();
    expect(before.ending).toBeUndefined();
    expect(before.ending_detail).toBeUndefined();
    expect((await api.reveal(episode.id, creator)).status).toBe(200);
    const after = await (await api.getEpisode(episode.id)).json();
    expect(after).toMatchObject({ ending: "friends", ending_detail: "slow_burn", ending_detail_label: "A slow burn" });
    const notes = await listNotifications(t.db, userIdOf(viewer));
    const scored = notes.find((n) => n.kind === "prediction_scored")!;
    expect(scored.title).toMatch(/scored: \+\d+ points/);
    expect(scored.body).toContain("it ended in just friends: a slow burn.");
  });

  it("a kind on the wrong ending, or one the show doesn't know, isn't shown", async () => {
    const { creator, episode } = await setupEpisode("friends");
    await t.db.query(`update episodes set ending_detail = 'walked_out' where id = $1`, [episode.id]);
    await api.reveal(episode.id, creator);
    const ep = await (await api.getEpisode(episode.id)).json();
    expect(ep.ending).toBe("friends");
    expect(ep.ending_detail).toBeUndefined();
  });
});

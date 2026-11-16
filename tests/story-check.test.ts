// The story check (lib/story-check.ts, docs/story-check.md, December wave A): the home page featured a date whose last
// lines were "Neither have I. Same channel next time?" over "A disaster". Here: the $0 rules on fixtures shaped like that
// date; the judge sees only what the episode page shows a stranger; the repair changes the finale and nothing else, and
// is refused when the new finale fails the PG check or contradicts the ending; the sweep's order, caps and switch; and a
// contradicting date kept off the home excerpt, the 18+ gate's pick, the home clip and the daily clip, with only
// `featurable: false` public. A fake model throughout: never a real call.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { storyCheckText } from "@/app/admin/analytics/QualityTab";
import { GET as countsRoute, POST as checkRoute } from "@/app/api/admin/story-check/route";
import { POST as uploadClip } from "@/app/api/admin/home-clip/route";
import type { Turn } from "@/lib/conversation";
import { pickFeaturedDate } from "@/lib/featured-date";
import { getEpisodeView, listStandoutDates } from "@/lib/game";
import { clipRefusal, latestHomeClip, saveHomeClip } from "@/lib/home-clip";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { StoredInner } from "@/lib/inner-life";
import { ModelError, setFrontierModelForTests, type ChatMessage, type Model, type ModelOptions } from "@/lib/model";
import { setObjectStoreForTests } from "@/lib/object-store";
import type { Ending } from "@/lib/rules";
import {
  checkEpisode,
  factsText,
  featurableFlag,
  featurableSql,
  finaleRefusal,
  isFeaturable,
  isWarmEmotion,
  parseVerdict,
  rulesVerdict,
  shortWhy,
  storyCheckCandidates,
  storyCheckCounts,
  storyCheckSweep,
  storyFacts,
  undoRepair,
  type ActLine,
  type StoryFacts,
  type StoryModels,
} from "@/lib/story-check";
import { pickClip } from "../scripts/clips/daily-clip.mjs";
import { api, BASE_URL, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

const KEY = ["owner", "pass", "story"].join("-");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(40, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 3)]);

/* ------------------------------------------------ fixtures ------------------------------------------------ */

const OPENING = ["So this is a silent disco.", "Pick a channel. Any channel.", "I brought my model town.", "Of course you did."];
/** The last act of the date that started this (12200cd2, 2026-11-16): warm to the end, then "A disaster". */
const WARM_ACT = [
  "Then you are my only witness. Please do not touch the layout.",
  "I would never. Though the stationmaster looks nervous.",
  "He has a family! They are two centimetres tall and very sad.",
  "Everyone is sad at a silent disco. That is why we all dance alone.",
  "Dance with me on the same channel. I will switch to yours. Hold the rope.",
  "Channel 2, then. Mind the double Gloucester.",
  "I have never been so frightened, or so flat-footed happy.",
  "Neither have I. Same channel next time?",
];
const OLD_FINALE = "They share one channel and one rope, and the stationmaster is spared";
const TWIST = "The narrating cheese was a cousin all along";

const turn = (side: "a" | "b", dialogue: string, emotion = "warm", interest = 0.5, extra: Partial<Turn> = {}): Turn => ({ side, act: 0, dialogue, action: "", emotion, interest, ...extra });
const lines = (texts: string[], emotion = "warm", interest = 0.5): Turn[] => texts.map((d, i) => turn(i % 2 ? "b" : "a", d, emotion, interest));
const RUDIGER_LINES: Turn[] = [...lines(OPENING), ...lines(WARM_ACT)];

/** An act as the facts carry it (the pure tests). */
const act = (texts: string[], emotion = "warm", interest = 0.5): ActLine[] =>
  texts.map((text, i) => ({ side: i % 2 ? "b" : "a", who: i % 2 ? "Ottoline Brackwater" : "Rudiger Pennyfold", emotion, interest, text, action: "", thought: null, walked_out: false }));

/** The real date's shape, as facts: a disaster, a warm last act, a happy finale, nothing on record that turns it. */
function facts(over: Partial<StoryFacts> = {}): StoryFacts {
  return {
    names: ["Rudiger Pennyfold", "Ottoline Brackwater"],
    place: "the silent disco",
    setting: "A silent disco on a model railway night.",
    ending: "disaster",
    ending_label: "A disaster",
    kind: null,
    kind_label: null,
    left_first: "Rudiger Pennyfold",
    rejected: null,
    walked_out: null,
    why: "A disaster: trust 44 finished low, and that outweighed chemistry 66.",
    acts: ["They meet at the silent disco.", "The model town comes out."],
    last_act: act(WARM_ACT),
    earlier_thoughts: [],
    choices: [],
    confessionals: [{ who: "Ottoline Brackwater", line: "He has a model town and no hills. I am cautiously thrilled." }],
    twist: TWIST,
    finale: OLD_FINALE,
    ...over,
  };
}

/** A fake paid model: answers in order (an Error is thrown), records what it was asked, reports a billed usage. */
function fakeModel(replies: (string | Error)[]) {
  const calls: { messages: ChatMessage[]; options?: ModelOptions }[] = [];
  const model: Model = {
    async complete(messages, options) {
      calls.push({ messages, options });
      const next = replies.shift();
      if (next === undefined) throw new Error("the fake model has no more replies");
      if (next instanceof Error) throw next;
      options?.onModel?.("anthropic/claude-haiku-5.5");
      options?.onUsage?.({ model: "anthropic/claude-haiku-5.5", input: 1500, cachedInput: 0, output: 60, thinking: 0, cost: 0.0004 });
      return next;
    },
  };
  return { model, calls, models: { quick: model, thinking: model } satisfies StoryModels };
}
const verdict = (v: string, reason = "Because.") => JSON.stringify({ verdict: v, reason });
const finale = (text: string) => JSON.stringify({ finale: text });
const GOOD_FINALE = "Rudiger Pennyfold leaves first and the rope goes slack: trust never caught up with the fun, so there is no next date.";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from home_clips");
  await t.db.query("delete from story_checks");
  setObjectStoreForTests(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setFrontierModelForTests(null);
  setObjectStoreForTests(undefined);
});

type DateOpts = {
  name?: string;
  ending?: Ending;
  transcript?: Turn[];
  finale?: string;
  confessionals?: [string, string] | null;
  shared?: boolean;
  inner?: StoredInner | null;
  detail?: string | null;
  drama?: { question: "leaves_first" | "rejected"; answer: "a" | "b" | "neither" } | null;
  chemistry?: number;
  agoMinutes?: number;
  aired?: boolean;
  visibility?: "public" | "private" | "unlisted";
  best_line?: string | null;
};

/** An aired public date between a person's character (side a) and a house character (side b), shaped as asked. */
async function airedDate(o: DateOpts = {}): Promise<string> {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name: o.name ?? "Rudiger Pennyfold" }), owner)).json()).id as string;
  const ending = o.ending ?? "disaster";
  scriptOutcome({ ending });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  if (o.aired !== false) expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  const drama = o.drama === undefined ? { question: "leaves_first", answer: "a" } : o.drama;
  await t.db.query(
    `update episodes set transcript = $2::jsonb, finale = $3, twist = $4, ending = $5, confessionals = $6::jsonb, confessionals_shared = $7,
            inner_life = $8::jsonb, ending_detail = $9, drama_question = $10, drama_answer = $11, visibility = $12, best_line = $13,
            revealed_at = case when $14::boolean then now() - make_interval(mins => $15::int) else null end,
            box_score = jsonb_set(coalesce(box_score, '{}'::jsonb), '{chemistry}', jsonb_build_object('start', 50, 'delta', $16::int - 50, 'final', $16::int))
      where id = $1`,
    [
      ep.id,
      JSON.stringify(o.transcript ?? RUDIGER_LINES),
      o.finale ?? OLD_FINALE,
      TWIST,
      ending,
      o.confessionals === null ? null : JSON.stringify(o.confessionals ?? ["She did not touch the layout. I may be in love.", "He has a model town and no hills. I am cautiously thrilled."]),
      o.shared ?? false,
      o.inner ? JSON.stringify(o.inner) : null,
      o.detail ?? null,
      drama?.question ?? null,
      drama?.answer ?? null,
      o.visibility ?? "public",
      o.best_line ?? null,
      o.aired !== false,
      o.agoMinutes ?? 60,
      o.chemistry ?? 66,
    ],
  );
  return ep.id as string;
}

const strangerView = async (id: string) => (await getEpisodeView(t.db, id, null))!;
const storyRow = async (id: string) => (await t.db.query<{ verdict: string; repaired: boolean; finale_before: string | null; model: string | null; reason: string }>(`select * from story_checks where episode_id = $1`, [id])).rows[0];
/** Everything about a date but its finale (and the clock columns nothing here touches): what a repair must never move. */
const allButFinale = async (id: string) => {
  const row = (await t.db.query<Record<string, unknown>>(`select * from episodes where id = $1`, [id])).rows[0];
  const { finale: _finale, ...rest } = row;
  return JSON.parse(JSON.stringify(rest));
};

/* ------------------------------------------------ the $0 rules ------------------------------------------------ */

describe("the rules (the $0 fallback)", () => {
  it("call the real date's shape a contradiction: a disaster whose whole last act is warm, and nothing turns it", () => {
    const r = rulesVerdict(facts());
    expect(r.verdict).toBe("contradicts");
    expect(r.reason).toMatch(/whole last act is warm/);
  });

  it("call a disaster that closes on a warm promise of a next time a contradiction, even with a cooler act before it", () => {
    const mixed = [...act(WARM_ACT.slice(0, 6), "guarded", 0.3), ...act(["I have never been so happy.", "Same channel next time?"], "warm", 0.6)];
    expect(rulesVerdict(facts({ last_act: mixed })).verdict).toBe("contradicts");
    // "in love", "again", "another date" read the same.
    for (const said of ["I think I may be in love.", "Let's do this again.", "So, another date?"]) {
      const lastAct = [...act(WARM_ACT.slice(0, 7), "guarded", 0.3), ...act([said], "delighted", 0.7)];
      expect(rulesVerdict(facts({ last_act: lastAct })).verdict, said).toBe("contradicts");
    }
  });

  it("pass a disaster when something on record turns it", () => {
    expect(rulesVerdict(facts({ choices: [{ who: "Rudiger Pennyfold", see_again: "no", reason: null }] })).verdict).toBe("consistent");
    expect(rulesVerdict(facts({ kind: "walked_out", kind_label: "A walk-out" })).verdict).toBe("consistent");
    expect(rulesVerdict(facts({ kind: "ghosted", kind_label: "Ghosted" })).verdict).toBe("consistent");
    expect(rulesVerdict(facts({ walked_out: "Ottoline Brackwater" })).verdict).toBe("consistent");
    expect(rulesVerdict(facts({ rejected: "Ottoline Brackwater", left_first: null })).verdict).toBe("consistent");
    // The finale saying the ending in so many words.
    for (const said of ["Neither wants another date.", "It is a disaster, rope and all.", "They part ways at the door.", "He turns her down at the door.", "They do not want a second date."]) {
      expect(rulesVerdict(facts({ finale: said })).verdict, said).toBe("consistent");
    }
  });

  it("don't count what explains nothing: a yes, nobody rejected, or who left first alone", () => {
    expect(rulesVerdict(facts({ choices: [{ who: "Rudiger Pennyfold", see_again: "yes", reason: null }] })).verdict).toBe("contradicts");
    expect(rulesVerdict(facts({ rejected: "Nobody", left_first: null })).verdict).toBe("contradicts");
    expect(rulesVerdict(facts({ left_first: "Rudiger Pennyfold" })).verdict).toBe("contradicts");
  });

  it("pass a disaster whose last act isn't warm, or whose warm words are said coolly", () => {
    expect(rulesVerdict(facts({ last_act: act(WARM_ACT, "guarded", 0.3) })).verdict).toBe("consistent");
    // "Next time" said gently with low interest is a brush-off, not a promise.
    const gentle = [...act(WARM_ACT.slice(0, 7), "flat", 0.2), ...act(["Maybe next time, then."], "gentle", 0.2)];
    expect(rulesVerdict(facts({ last_act: gentle })).verdict).toBe("consistent");
    // Warm but at low interest isn't the glaring shape either.
    expect(rulesVerdict(facts({ last_act: act(WARM_ACT, "warm", 0.3) })).verdict).toBe("consistent");
  });

  it("let just friends be warm, but not romantic with nothing to say why", () => {
    const friends = { ending: "friends" as const, ending_label: "Just friends", finale: "They walk to the tram." };
    expect(rulesVerdict(facts({ ...friends, last_act: act(["You're good company.", "So are you. See you around."]) })).verdict).toBe("consistent");
    expect(rulesVerdict(facts({ ...friends, last_act: act(["I think I'm falling for you.", "So, a second date?"], "smitten", 0.8) })).verdict).toBe("contradicts");
    expect(rulesVerdict(facts({ ...friends, last_act: act(["So, a second date?"], "hopeful", 0.8), choices: [{ who: "Ottoline Brackwater", see_again: "maybe", reason: null }] })).verdict).toBe("consistent");
    expect(rulesVerdict(facts({ ...friends, last_act: act(["So, a second date?"], "hopeful", 0.8), finale: "They stay friends, nothing more." })).verdict).toBe("consistent");
  });

  it("never call a second date glaring (the model judges those)", () => {
    expect(rulesVerdict(facts({ ending: "second_date", ending_label: "A second date", last_act: act(WARM_ACT, "cold", 0.1) })).verdict).toBe("consistent");
  });

  it("read the actors' emotions as warm only when every word is", () => {
    expect(isWarmEmotion("warm")).toBe(true);
    expect(isWarmEmotion("dryly amused")).toBe(true);
    expect(isWarmEmotion("Playful, delighted")).toBe(true);
    expect(isWarmEmotion("warm but wary")).toBe(false);
    expect(isWarmEmotion("guarded")).toBe(false);
    expect(isWarmEmotion("")).toBe(false);
  });
});

describe("the judge's answer and what it reads", () => {
  it("takes a verdict out of a fenced or chatty reply, and refuses anything else", () => {
    expect(parseVerdict('```json\n{"verdict": "reversal", "reason": "He leaves first."}\n```')).toEqual({ verdict: "reversal", reason: "He leaves first." });
    expect(parseVerdict('Sure: {"verdict": "Hidden truth", "reason": "Her thought."}')).toEqual({ verdict: "hidden_truth", reason: "Her thought." });
    expect(parseVerdict('{"verdict": "fine", "reason": "x"}')).toBeNull();
    expect(parseVerdict("contradicts")).toBeNull();
    expect(parseVerdict(JSON.stringify({ verdict: "contradicts", reason: "x".repeat(900) }))!.reason.length).toBeLessThanOrEqual(240);
  });

  it("keeps the box score's own why without its arithmetic", () => {
    const why = "A disaster: trust 44 finished low, and that outweighed chemistry 66. Endings read where the numbers finished, not how far they moved. By the numbers: a date played for fun counts chemistry 40%. This one came out −1.2 against an ordinary date.";
    expect(shortWhy(why)).toBe("A disaster: trust 44 finished low, and that outweighed chemistry 66.");
    expect(shortWhy(null)).toBeNull();
  });

  it("hands the judge what the episode page shows a stranger once aired, and never a hidden thought or confessional", async () => {
    // Side a is a person's character (its thoughts and confessional stay private unless the host shares them); side b is
    // the house's (its diary cam and thoughts air with the date).
    const transcript = [...RUDIGER_LINES];
    // Line 2 is side a's (the person's), line 11 side b's (the house's).
    const inner: StoredInner = {
      v: 1,
      lines: transcript.map((_, i) => (i === 2 ? { thought: "SECRET-A-THOUGHT she will never call" } : i === 11 ? { thought: "VISIBLE-B-THOUGHT this was lovely, and it is over" } : null)),
      choices: { a: { see_again: "no", reason: "SECRET-A-REASON not ready" }, b: { see_again: "maybe", reason: "VISIBLE-B-REASON too soon" } },
    };
    expect(transcript[2].side).toBe("a");
    expect(transcript[11].side).toBe("b");
    const id = await airedDate({ transcript, inner, confessionals: ["SECRET-A-CONFESSIONAL I may be in love", "VISIBLE-B-DIARY cautiously thrilled"] });
    const f = storyFacts(await strangerView(id))!;
    const text = factsText(f);
    expect(text).toContain("VISIBLE-B-THOUGHT");
    expect(text).toContain("VISIBLE-B-REASON");
    expect(text).toContain("VISIBLE-B-DIARY");
    expect(text).not.toMatch(/SECRET-A/);
    // Both answers to "see them again?" air; only the shown side's reason does.
    expect(f.choices.map((c) => c.see_again).sort()).toEqual(["maybe", "no"]);
    expect(text).toContain("Who left first: Rudiger Pennyfold");
    expect(text).toContain(`The recap's finale: ${OLD_FINALE}`);
    expect(f.last_act).toHaveLength(8);
    expect(f.last_act.at(-1)!.text).toBe("Neither have I. Same channel next time?");

    // Shared confessionals air both sides' thoughts and lines.
    await t.db.query(`update episodes set confessionals_shared = true where id = $1`, [id]);
    expect(factsText(storyFacts(await strangerView(id))!)).toContain("SECRET-A-CONFESSIONAL");
  });
});

/* ------------------------------------------------ one date ------------------------------------------------ */

describe("checking one date", () => {
  it("keeps a passing verdict with its model, version and cost, and changes nothing on the date", async () => {
    const id = await airedDate();
    const before = await allButFinale(id);
    const fake = fakeModel([verdict("hidden_truth", "Her diary says she is only cautiously thrilled.")]);
    const done = await checkEpisode(t.db, id, { models: fake.models });
    expect("row" in done && done.row).toMatchObject({ verdict: "hidden_truth", repaired: false, finale_before: null, model: "anthropic/claude-haiku-5.5", prompt_version: "story-check-1", input_tokens: 1500, output_tokens: 60, cost_usd: 0.0004 });
    // One call, no thinking, real room for the answer.
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].options?.maxTokens).toBeGreaterThanOrEqual(400);
    expect(await allButFinale(id)).toEqual(before);
    expect((await strangerView(id)).finale).toBe(OLD_FINALE);
    expect((await strangerView(id)).featurable).toBeUndefined();
  });

  it("falls to the rules with no paid model, or when the call fails twice, and says so", async () => {
    const id = await airedDate();
    const none = await checkEpisode(t.db, id, { models: null });
    expect("row" in none && none.row).toMatchObject({ verdict: "contradicts", model: "rules", cost_usd: 0, repaired: false });

    const other = await airedDate({ name: "Mira Quell", transcript: [...lines(OPENING), ...lines(WARM_ACT, "guarded", 0.3)] });
    const failing = fakeModel([new Error("timeout"), "not json at all"]);
    const done = await checkEpisode(t.db, other, { models: failing.models });
    expect(failing.calls).toHaveLength(2);
    expect("row" in done && done.row).toMatchObject({ verdict: "consistent", model: "rules" });
  });

  it("checks only an aired public date, and never calls the model for any other", async () => {
    const fake = fakeModel([]);
    const unaired = await airedDate({ aired: false });
    expect(await checkEpisode(t.db, unaired, { models: fake.models })).toEqual({ error: "not_aired" });
    const unlisted = await airedDate({ name: "Pell Ardent", visibility: "unlisted" });
    expect(await checkEpisode(t.db, unlisted, { models: fake.models })).toEqual({ error: "not_public" });
    expect(await checkEpisode(t.db, "no-such-date", { models: fake.models })).toEqual({ error: "episode_not_found" });
    expect(fake.calls).toHaveLength(0);
    expect((await t.db.query(`select count(*)::int as n from story_checks`)).rows[0]).toEqual({ n: 0 });
  });

  it("repairs a contradicting finale from the record, judged again, and changes nothing else", async () => {
    const id = await airedDate();
    const before = await allButFinale(id);
    const fake = fakeModel([verdict("contradicts", "A warm last act, a happy finale, and A disaster."), finale(GOOD_FINALE), verdict("reversal", "Rudiger leaving first turns it.")]);
    const done = await checkEpisode(t.db, id, { models: fake.models, repair: true });
    expect("row" in done && done.row).toMatchObject({ verdict: "reversal", repaired: true, finale_before: OLD_FINALE });
    expect(fake.calls).toHaveLength(3);
    // The repair was told the record and the ending to make plain; the second judgement read the new finale.
    expect(fake.calls[1].messages[1].content).toContain("ON THE RECORD");
    expect(fake.calls[1].messages[1].content).toContain("there is no next date");
    expect(fake.calls[2].messages[1].content).toContain(`The recap's finale: ${GOOD_FINALE}`);
    // Only the finale moved: the lines, the twist, the ending, the confessionals, the scores are as they were.
    expect(await allButFinale(id)).toEqual(before);
    const view = await strangerView(id);
    expect(view.finale).toBe(GOOD_FINALE);
    expect(view.featurable).toBeUndefined();
    // The public JSON shows the new finale (nothing caches the old one).
    const json = await (await api.getEpisode(id)).json();
    expect(json.finale).toBe(GOOD_FINALE);

    // An admin's undo puts the old finale back, and the date is off the featured places again.
    expect(await undoRepair(t.db, id)).toEqual({ ok: true, finale: OLD_FINALE });
    expect((await strangerView(id)).finale).toBe(OLD_FINALE);
    expect(await storyRow(id)).toMatchObject({ verdict: "contradicts", repaired: false, finale_before: null });
    expect((await strangerView(id)).featurable).toBe(false);
    expect(await undoRepair(t.db, id)).toEqual({ error: "not_repaired" });
  });

  it("refuses a repair that fails the PG check or contradicts the ending, and keeps the finale", async () => {
    const id = await airedDate();
    const before = await allButFinale(id);
    const fake = fakeModel([
      verdict("contradicts"),
      finale("Rudiger Pennyfold leaves first; they never spend the night together, so there is no next date."), // innuendo
      finale("Rudiger Pennyfold leaves first, but they agree on a second date anyway."), // contradicts "A disaster"
    ]);
    const done = await checkEpisode(t.db, id, { models: fake.models, repair: true });
    expect("row" in done && done.row).toMatchObject({ verdict: "contradicts", repaired: false, finale_before: null });
    expect(fake.calls).toHaveLength(3); // no second judgement: no finale passed
    expect((await strangerView(id)).finale).toBe(OLD_FINALE);
    expect(await allButFinale(id)).toEqual(before);
    expect((await strangerView(id)).featurable).toBe(false);
  });

  it("puts nothing in when the new finale still doesn't pass the judge", async () => {
    const id = await airedDate();
    const fake = fakeModel([verdict("contradicts"), finale(GOOD_FINALE), verdict("contradicts", "Still warm."), verdict("contradicts", "Still warm.")]);
    const done = await checkEpisode(t.db, id, { models: fake.models, repair: true });
    expect("row" in done && done.row).toMatchObject({ verdict: "contradicts", repaired: false, finale_before: null });
    expect((await strangerView(id)).finale).toBe(OLD_FINALE);
  });

  it("leaves the finale alone with STORY_CHECK_REPAIR=0", async () => {
    vi.stubEnv("STORY_CHECK_REPAIR", "0");
    const id = await airedDate();
    const fake = fakeModel([verdict("contradicts")]);
    const done = await checkEpisode(t.db, id, { models: fake.models });
    expect("row" in done && done.row).toMatchObject({ verdict: "contradicts", repaired: false });
    expect(fake.calls).toHaveLength(1);
    expect((await strangerView(id)).finale).toBe(OLD_FINALE);
  });

  it("refuses a rewritten finale that is long, quoted, the same, or names someone off the record", () => {
    const f = facts();
    expect(finaleRefusal(GOOD_FINALE, f)).toBeNull();
    expect(finaleRefusal("One. Two. Three sentences is too many.", f)).toBe("too_long");
    expect(finaleRefusal('Rudiger Pennyfold says "never again" and there is no next date.', f)).toBe("quoted");
    expect(finaleRefusal(OLD_FINALE, f)).toBe("unchanged");
    expect(finaleRefusal("Rudiger Pennyfold leaves first with Bartholomew, and there is no next date.", f)).toBe("new_name");
    expect(finaleRefusal("They part as just friends, and there is no next date.", f)).toBe("contradicts_ending");
    expect(finaleRefusal("They never spend the night together, and there is no next date.", f)).toBe("not_pg");
  });
});

/* ------------------------------------------------ the featured places ------------------------------------------------ */

describe("a contradicting date is never featured", () => {
  it("marks only featurable: false on the public JSON, never the verdict or its reason", async () => {
    const id = await airedDate();
    await checkEpisode(t.db, id, { models: fakeModel([verdict("contradicts", "PRIVATE-REASON warm act")]).models, repair: false });
    const res = await api.getEpisode(id);
    const body = await res.text();
    expect(JSON.parse(body).featurable).toBe(false);
    expect(body).not.toMatch(/PRIVATE-REASON|story_verdict|contradicts|"verdict"/);
    const feed = await (await api.feed()).text();
    expect(feed).toContain('"featurable":false');
    expect(feed).not.toMatch(/PRIVATE-REASON|story_verdict|contradicts/);
    // A passing or unchecked date carries nothing at all.
    const other = await airedDate({ name: "Mira Quell" });
    expect(JSON.parse(await (await api.getEpisode(other)).text())).not.toHaveProperty("featurable");
    expect(featurableFlag("consistent")).toEqual({});
    expect(featurableFlag(null)).toEqual({});
    expect(isFeaturable({})).toBe(true);
    expect(isFeaturable({ featurable: false })).toBe(false);
  });

  it("keeps it off the home excerpt and the 18+ gate's pick, and off the standout list (a checked pass first among equals)", async () => {
    const bad = await airedDate({ chemistry: 95, agoMinutes: 10 });
    const unchecked = await airedDate({ name: "Mira Quell", chemistry: 70, agoMinutes: 30 });
    const passed = await airedDate({ name: "Pell Ardent", chemistry: 70, agoMinutes: 60 });
    await checkEpisode(t.db, bad, { models: null });
    await checkEpisode(t.db, passed, { models: fakeModel([verdict("consistent")]).models });
    expect(await storyRow(bad)).toMatchObject({ verdict: "contradicts" });

    const standout = await listStandoutDates(t.db, null);
    // The contradicting one is out though it scores best; the checked pass leads the unchecked one at an equal score.
    expect(standout.map((e) => e.id)).toEqual([passed, unchecked]);
    // pickFeaturedDate skips it even when a list hands it over (the gate's own date, the watch feed).
    const views = await Promise.all([bad, unchecked].map(strangerView));
    expect(pickFeaturedDate(views)?.episode_id).toBe(unchecked);
    expect(pickFeaturedDate([views[0]])).toBeNull();
  });

  it("keeps it off the home clip: the newest clip that isn't contradicting plays, and the upload route refuses it", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", KEY);
    const older = await airedDate({ name: "Mira Quell" });
    const newest = await airedDate();
    const clip = { day: "2026-11-15", loop: MP4, poster: JPEG, width: 480, height: 854, seconds: 12 };
    await saveHomeClip(t.db, { ...clip, episode_id: older });
    await t.db.query(`update home_clips set created_at = now() - interval '1 day' where episode_id = $1`, [older]);
    await saveHomeClip(t.db, { ...clip, episode_id: newest });
    expect((await latestHomeClip(t.db))?.episode_id).toBe(newest);

    await checkEpisode(t.db, newest, { models: null });
    expect((await latestHomeClip(t.db))?.episode_id).toBe(older);
    expect(clipRefusal(await strangerView(newest))).toBe("story_contradicts");

    const form = new FormData();
    form.set("episode", newest);
    form.set("loop", new Blob([MP4], { type: "video/mp4" }));
    form.set("poster", new Blob([JPEG], { type: "image/jpeg" }));
    form.set("width", "480");
    form.set("height", "854");
    form.set("seconds", "12");
    const res = await uploadClip(new Request(`${BASE_URL}/api/admin/home-clip`, { method: "POST", headers: { "x-frontier-key": KEY }, body: form }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("story_contradicts");
  });

  it("keeps it out of the daily clip's pick", () => {
    const ep = (id: string, extra: Record<string, unknown> = {}) => ({ id, revealed: true, ending: "disaster", best_line: "Same channel next time?", transcript: Array.from({ length: 12 }, () => ({})), ...extra });
    expect(pickClip([ep("bad", { featurable: false }), ep("good")])?.id).toBe("good");
    expect(pickClip([ep("bad", { featurable: false })])).toBeNull();
  });

  it("features everything as today with STORY_CHECK=0", async () => {
    const id = await airedDate();
    await checkEpisode(t.db, id, { models: null });
    await saveHomeClip(t.db, { episode_id: id, day: "2026-11-15", loop: MP4, poster: JPEG, width: 480, height: 854, seconds: 12 });
    expect(await latestHomeClip(t.db)).toBeNull();
    vi.stubEnv("STORY_CHECK", "0");
    expect(featurableSql("e")).toBe("(e.id is not null)");
    expect((await latestHomeClip(t.db))?.episode_id).toBe(id);
    expect((await strangerView(id)).featurable).toBeUndefined();
    expect((await listStandoutDates(t.db, null)).map((e) => e.id)).toEqual([id]);
    expect(await storyCheckSweep(t.db)).toEqual({ off: true });
  });
});

/* ------------------------------------------------ the sweep ------------------------------------------------ */

describe("the sweep", () => {
  it("checks what is featured first: the home clip, then the standout list in its order, then the newest, back the window", async () => {
    const clipped = await airedDate({ name: "Clip Date", agoMinutes: 20 * 24 * 60, chemistry: 10 });
    const fresh = await airedDate({ name: "Fresh Date", agoMinutes: 30, chemistry: 10 });
    const top = await airedDate({ name: "Top Date", agoMinutes: 2 * 24 * 60, chemistry: 95 });
    const older = await airedDate({ name: "Older Date", agoMinutes: 25 * 24 * 60 });
    const tooOld = await airedDate({ name: "Too Old Date", agoMinutes: 40 * 24 * 60 });
    const checked = await airedDate({ name: "Checked Date", agoMinutes: 90 });
    await airedDate({ name: "Unaired Date", aired: false });
    await airedDate({ name: "Private Date", visibility: "private" });
    await saveHomeClip(t.db, { episode_id: clipped, day: "2026-11-15", loop: MP4, poster: JPEG, width: 480, height: 854, seconds: 12 });
    await checkEpisode(t.db, checked, { models: null });

    const all = await storyCheckCandidates(t.db, new Date(), 10, 30, 1);
    expect(all).toEqual({ ids: [clipped, top, fresh, older], total: 4 });
    expect(all.ids).not.toContain(tooOld);
    expect(await storyCheckCandidates(t.db, new Date(), 2, 30, 1)).toEqual({ ids: [clipped, top], total: 4 });
    // A longer window reaches further back.
    expect((await storyCheckCandidates(t.db, new Date(), 10, 45, 1)).ids).toContain(tooOld);
  });

  it("judges at most STORY_CHECK_PER_HOUR a pass, says what it spent, and logs counts only", async () => {
    vi.stubEnv("STORY_CHECK_PER_HOUR", "2");
    const ids = [await airedDate({ name: "Ann Date", agoMinutes: 10 }), await airedDate({ name: "Bea Date", agoMinutes: 20 }), await airedDate({ name: "Cy Date", agoMinutes: 30 })];
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => void logs.push(String(s)));
    const fake = fakeModel([verdict("consistent"), verdict("reversal")]);
    const out = await storyCheckSweep(t.db, new Date(), { models: fake.models, concurrency: 1, repair: false });
    expect(out).toMatchObject({ checked: 2, consistent: 1, reversal: 1, contradicts: 0, by_rules: 0, left: 1, stopped: false, input_tokens: 3000, output_tokens: 120, cost_usd: 0.0008 });
    expect(fake.calls).toHaveLength(2);
    expect(await storyRow(ids[2])).toBeUndefined(); // the oldest waits for the next pass
    const event = logs.map((l) => JSON.parse(l)).find((l) => l.event === "story_check");
    expect(event).toMatchObject({ log: "analytics", checked: 2, cost_usd: 0.0008 });
    expect(JSON.stringify(event)).not.toMatch(new RegExp(ids.join("|")));
  });

  it("stops the pass when the provider refuses for rate or credit, leaving the rest for later", async () => {
    await airedDate({ name: "Ann Date", agoMinutes: 10 });
    await airedDate({ name: "Bea Date", agoMinutes: 20 });
    const busy = fakeModel([new ModelError("rate limited", 429), new ModelError("rate limited", 429)]);
    const out = await storyCheckSweep(t.db, new Date(), { models: busy.models, concurrency: 1 });
    expect(out).toMatchObject({ checked: 1, by_rules: 1, stopped: true, left: 1 });
    expect(busy.calls).toHaveLength(2);
  });

  it("runs from the hourly lobby job, best-effort, its result in the job's answer", () => {
    const route = readFileSync(new URL("../app/api/jobs/lobby/route.ts", import.meta.url), "utf8");
    expect(route).toMatch(/await storyCheckSweep\(db\)\.catch\(\(\) => null\)/);
    expect(route).toMatch(/story_check: storyCheck/);
  });
});

/* ------------------------------------------------ the admin route ------------------------------------------------ */

describe("the admin route", () => {
  const post = (body: unknown, key: string | null = KEY) =>
    checkRoute(new Request(`${BASE_URL}/api/admin/story-check`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-frontier-key": key } : {}) }, body: JSON.stringify(body) }));
  const get = (key: string | null = KEY) => countsRoute(new Request(`${BASE_URL}/api/admin/story-check`, { headers: key ? { "x-frontier-key": key } : {} }));

  it("checks one date now, runs a backfill, and counts the verdicts of the last 7 and 30 days", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", KEY);
    const bad = await airedDate();
    const fine = await airedDate({ name: "Mira Quell", agoMinutes: 9 * 24 * 60 });
    expect((await post({ episode_id: bad }, null)).status).toBe(403);
    expect((await get(null)).status).toBe(403);

    setFrontierModelForTests(fakeModel([verdict("contradicts", "Warm to the end."), finale(GOOD_FINALE), verdict("reversal", "He leaves first."), verdict("consistent")]).model);
    const one = await post({ episode_id: bad });
    expect(one.status).toBe(200);
    expect((await one.json()).story_check).toMatchObject({ episode_id: bad, verdict: "reversal", repaired: true, finale_before: OLD_FINALE });

    const backfill = await post({ backfill: 5 });
    expect(JSON.parse((await backfill.text()).trim()).story_check).toMatchObject({ checked: 1, consistent: 1 });
    expect(await storyRow(fine)).toMatchObject({ verdict: "consistent" });

    const counts = await (await get()).json();
    expect(counts.last_7).toMatchObject({ aired: 1, checked: 1, reversal: 1, repaired: 1, contradicts: 0, written_contradicts_share: 1 });
    expect(counts.last_30).toMatchObject({ aired: 2, checked: 2, consistent: 1, reversal: 1, repaired: 1, written_contradicts_share: 0.5 });
    expect(counts.last_30.cost_usd).toBeCloseTo(0.0016, 6);
    expect(await storyCheckCounts(t.db)).toMatchObject({ on: true, repair: true });
    // The same counts, as the quiet line on /admin/analytics → Quality.
    expect(storyCheckText(counts)).toBe(
      "Story check: last 7 days 1 of 1 aired dates checked: 0 consistent, 0 hidden truth, 1 reversal, 0 contradicting (not featured), 1 finale repaired; $0.00. " +
        "Last 30 days 2 of 2 aired dates checked: 1 consistent, 0 hidden truth, 1 reversal, 0 contradicting (not featured), 1 finale repaired; $0.00.",
    );

    expect((await post({ episode_id: "no-such-date" })).status).toBe(404);
    expect((await post({ episode_id: bad, undo: true })).status).toBe(200);
    expect((await post({ episode_id: bad, undo: true })).status).toBe(409);
    expect((await post({ backfill: 0 })).status).toBe(422);
    vi.stubEnv("STORY_CHECK", "0");
    expect((await post({ episode_id: bad })).status).toBe(404);
  });
});

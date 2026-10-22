import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as evalPost } from "@/app/api/jobs/eval-after-dark/route";
import { agreedMove, isPublicPlace, settlePlace, shownMove } from "@/lib/adult/continuity";
import { activeLimit, limitIn, limitsIn, linesAtPlace, repairPlacePronouns, thresholdOf, wrongPossessives } from "@/lib/adult/craft";
import { citeMemory, factMessages, isQuoteDump, parseFacts, sheetMemories } from "@/lib/adult/facts";
import { guardAlternation } from "@/lib/adult/guards";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { observeNight, reportMarkdown, type ObservedSide } from "@/lib/adult/observer";
import {
  copiedRun,
  countPhrases,
  hooksOf,
  phraseNames,
  phrasesIn,
  questionHabit,
  sceneQuality,
  sideOfCharacter,
  topPhrases,
  whyIsGeneric,
  whyRestatesTrait,
  wornIn,
} from "@/lib/adult/quality";
import { emptyScene, sceneMessages, writeSceneStep, type SceneLine, type SceneState, type StepInput } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage, Model, ModelOptions } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { houseCharacter } from "./after-dark-prompt-cases";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Prompt v2.1 (David's review of a v2 night, Star Dust × Sable Quist, 2026-10-21, 59 lines; and the coordinator's prod
// runs that day): worn phrases, question endings, hooks, limits, pronouns, a stuck doorway, a new pair's memory, the
// arc, a move the lines show, public places, the repeat lock, copies of show lines, cascades, and the facts extracted.

const juniper = () => houseCharacter("house-juniper");
const sable = () => houseCharacter("house-sable");
const rafe = () => houseCharacter("house-rafe");
const PAIR = { a: { id: "house-juniper", name: "Juniper Vale" }, b: { id: "house-sable", name: "Sable Quist" } };
const NAMES = [PAIR.a.name, PAIR.b.name];

/** A scripted model that keeps every call; each call takes the next reply (the last repeats). */
function scripted(...replies: unknown[]) {
  const calls: { messages: ChatMessage[]; options?: ModelOptions }[] = [];
  const model: Model = {
    complete: async (messages, options) => {
      calls.push({ messages, options });
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  };
  return { model, calls };
}
const lines = (...xs: ([("a" | "b"), string] | [("a" | "b"), string, Record<string, unknown>])[]) => xs.map(([who, text, extra]) => ({ who, text, ...(extra ?? {}) }));
const reply = (xs: ReturnType<typeof lines>, extra: Record<string, unknown> = {}) => ({ lines: xs.map((l) => ({ why: "her hobby", memory: null, ...l })), ...extra });
/** One step of a Juniper × Sable scene (both she/her), v2 unless asked otherwise. */
const step = (model: Model, over: Partial<StepInput> = {}) =>
  writeSceneStep({
    model,
    a: juniper(),
    b: sable(),
    pair: PAIR,
    date: null,
    scene: emptyScene(),
    steer: null,
    steerMode: "nudge",
    promptVersion: "v2",
    sampling: { temperature: 0.8, frequency_penalty: 0.3, presence_penalty: 0.3, repetition_penalty: null },
    memories: [],
    facts: [],
    styles: { a: [], b: [] },
    cast: new Set(),
    ...over,
  });
const sceneWith = (night: SceneLine[], over: Partial<SceneState> = {}): SceneState => ({ ...emptyScene(), lines: night, ...over });
const v2 = (night: SceneLine[], now: Record<string, unknown> = {}, a = juniper(), b = sable()) =>
  sceneMessages(a, b, null, night, null, PAIR.a.id, { place: "her kitchen", stage: 0, linesAtStage: 0, opening: false, promptVersion: "v2", ...now } as never);
const v1 = (night: SceneLine[], now: Record<string, unknown> = {}) =>
  sceneMessages(juniper(), sable(), null, night, null, PAIR.a.id, { place: "her kitchen", stage: 0, linesAtStage: 0, opening: false, promptVersion: "v1", ...now } as never);

/** Varied filler, so a test's own lines are the only pattern in it. */
const FILLER_A = [
  "The fog came in thick around the gallery tonight.",
  "My thermos still has half the cocoa in it.",
  "I logged eleven ships before supper.",
  "The gulls were quarrelling over a crust again.",
  "Episode forty is about a drowned bell.",
  "My boots are drying by the stove downstairs.",
  "Somebody left a postcard wedged in the door.",
  "I painted the railings blue last spring.",
  "The radio crackles whenever the tide turns.",
  "There's a crab in the rain barrel, I think.",
];
const FILLER_B = [
  "I brought confetti in three colours!",
  "My van has exactly one working headlight.",
  "Hats are a lifestyle, not a choice.",
  "I once threw a party for a retired mailman.",
  "Glitter never leaves, it only relocates!",
  "Tell me everything about the bell!",
  "The cake was lemon, and it was perfect.",
  "My neighbour taught me to juggle limes.",
  "I'm banned from one karaoke bar, lovingly.",
  "Balloons are cheaper by the hundred, did you know?",
];
const banter = (n: number, offset = 0): SceneLine[] =>
  Array.from({ length: n }, (_, i) => ({ who: i % 2 ? "b" : "a", text: (i % 2 ? FILLER_B : FILLER_A)[(Math.floor(i / 2) + offset) % 10] }) as SceneLine);

describe("(3) worn phrases: the night-level phrase critic", () => {
  const names = phraseNames(...NAMES);

  it("reads a line's phrases (2 to 4 words in a clause), never one of glue alone or with a name in it", () => {
    const p = phrasesIn("*grins* Let's see how you handle this, Sable.", names);
    expect([...p]).toEqual(expect.arrayContaining(["let's see", "let's see how", "handle this"]));
    expect(p.has("see how")).toBe(false); // glue only
    expect(p.has("this sable")).toBe(false); // across a comma, and a name
    expect([...phrasesIn("Are you in the mood?", names)]).toEqual(expect.arrayContaining(["the mood"]));
    expect(phrasesIn("Are you in the mood?", names).has("in the")).toBe(false);
    expect(phrasesIn("Oh, Sable, Sable.", names).size).toBe(0);
  });

  it("a phrase in three of a character's lines is worn; the most worn are listed, a longer one over the shorter inside it", () => {
    const said = lines(["a", "Let's see how you handle the fog horn."], ["a", "Let's see who blinks first."], ["a", "*grins* Let's see if the gulls agree."]);
    const counts = countPhrases(said, names);
    expect(counts.get("let's see")).toBe(3);
    expect(wornIn("Let's see what you've got.", counts, names)).toEqual({ phrase: "let's see", count: 3 });
    expect(wornIn("I brought the good lantern.", counts, names)).toBeNull();
    expect(topPhrases(counts, 8, 3)).toEqual([{ phrase: "let's see", count: 3 }]);
    const main = countPhrases(lines(["b", "The main event is later."], ["b", "Save it for the main event."], ["b", "That was just the main event."]), names);
    expect(topPhrases(main, 5, 3)).toEqual([{ phrase: "the main event", count: 3 }]);
  });

  const worn: SceneLine[] = lines(
    ["a", "Let's see how you handle the fog horn."],
    ["b", FILLER_B[0]],
    ["a", "Let's see who blinks first."],
    ["b", FILLER_B[1]],
    ["a", "*grins* Let's see if the gulls agree."],
    ["b", FILLER_B[2]],
  );

  it("lists each one's worn phrases in the v2 prompt, and not in v1", () => {
    expect(v2(worn)[0].content).toContain(
      `Worn phrases (each already in 3 or more of their lines tonight; don't use them again, or anything close): Juniper: "let's see".`,
    );
    expect(v1(worn)[0].content).not.toContain("Worn phrases");
  });

  it("through a step: a fourth use loses its sentence, and the line goes when nothing's left (v2 only)", async () => {
    const out = reply(lines(["a", "Let's see what you've got."], ["b", "Show me the lantern room, keeper."], ["a", "*laughs* Let's see. I brought the good lantern."], ["b", "Then lead on."]));
    const { model } = scripted(out);
    const r = await step(model, { scene: sceneWith(worn) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => l.text)).toEqual(["Show me the lantern room, keeper.", "*laughs* I brought the good lantern.", "Then lead on."]);
    expect(r.dropped).toEqual([{ who: "a", text: "Let's see what you've got.", reason: `a worn phrase ("let's see", already in 3 of their lines tonight)` }]);
    expect(r.flags.worn_phrases).toBe(2);
    // v1 never listed them, so it keeps them.
    const old = await step(scripted(out).model, { scene: sceneWith(worn), promptVersion: "v1" });
    expect(old.ok && old.lines.map((l) => l.text)[0]).toBe("Let's see what you've got.");
  });
});

describe("(3b) question endings", () => {
  const night = (questions: number): SceneLine[] =>
    banter(20).map((l, i) => (l.who === "a" && Math.floor(i / 2) < questions ? { ...l, text: l.text.replace(/[.!]$/, "?") } : l));

  it("when more than 40% of a character's last lines end on a question, the v2 prompt says to vary it", () => {
    expect(questionHabit(night(6), "a")).toEqual({ questions: 6, of: 10 });
    expect(v2(night(6))[0].content).toContain("- Juniper has ended 6 of her last 10 lines on a question: vary it, with a statement, an action or a silence.");
    expect(questionHabit(night(4), "a")).toBeNull();
    expect(v2(night(4))[0].content).not.toContain("on a question: vary it");
    expect(v1(night(6))[0].content).not.toContain("on a question");
  });
});

describe("(3c) hooks", () => {
  const SABLE = [
    "Surprise! I hid a cake in your oven.",
    "Bring a coat, the stars are out tonight.",
    "I love a good surprise, you know that.",
    "Your lighthouse has so many stairs!",
    "Are you surprised? You look surprised.",
    "Gulls are just loud pigeons with ambition.",
    "Surprises are my whole thing, honestly!",
    "Is that cocoa? Can I have some?",
    "One more surprise and then we sit down.",
    "I counted forty steps on the way up.",
    "Nobody surprises me twice, you'll see.",
    "Your coat smells like salt and woodsmoke.",
  ];
  const night: SceneLine[] = SABLE.flatMap((text, i) => [{ who: "a" as const, text: FILLER_A[i % 10] }, { who: "b" as const, text }]);

  it("finds the theme a character keeps coming back to, as one stem", () => {
    expect(hooksOf(night, "b", NAMES)).toEqual([{ word: "surprise", stem: "surpris", lines: 6, of: 12 }]);
    expect(hooksOf(night, "a", NAMES)).toEqual([]);
  });

  it("tells the model to show other sides of her, from her sheet, naming which (never the hook itself)", () => {
    const system = v2(night)[0].content;
    expect(system).toContain(`- Sable keeps coming back to "surprise" (6 of her last 12 lines). Show other sides of her, from her sheet, and name the one a line uses in its "why": her hobby (Party planning); her tell when smitten (go oddly quiet and just listen); her humour and voice (Loud and fast:`);
    // Her job, "Professional surpriser", is the hook again: not offered.
    expect(system).not.toContain("her job (Professional surpriser)");
  });
});

describe("(4) limits", () => {
  it("hears a limit or a pause, and not the lines that ask for more", () => {
    expect(limitIn("*grips Sable's wrist* Slow down… let's not rush.")).toBe("Slow down… let's not rush.");
    expect(limitIn("Wait.")).toBe("Wait.");
    expect(limitIn("Hold on, Juniper.", NAMES)).toBe("Hold on, Juniper.");
    for (const yes of ["Not yet, keeper.", "I'm not ready.", "Can we pause a moment?", "Stop, please.", "This is too fast.", "Stop. I mean it.", "No.", "Easy now."]) expect(limitIn(yes), yes).not.toBeNull();
    for (const no of [
      "Don't stop.",
      "I can't wait to see the lantern room.",
      "Stop teasing me.",
      "Wait, you knew all along?",
      "Wait. You have a cat?",
      "No. You didn't!",
      "Wait until you see the view.",
      "Don't stop, not yet.",
      "We'll go slow. Tell me when.",
    ])
      expect(limitIn(no), no).toBeNull();
  });

  const limited: SceneLine[] = lines(
    ["a", "*kisses her neck* You smell like the sea.", { stage: 3 }],
    ["b", "*unbuttons Juniper's coat* Finally.", { stage: 3 }],
    ["a", "*grips Sable's wrist* Slow down… let's not rush.", { stage: 3 }],
  );

  it("a limit stands until the other checks in and gets a yes, or the one who set it says go on", () => {
    expect(activeLimit(limited, NAMES)).toEqual({ at: 2, who: "a", said: "Slow down… let's not rush." });
    expect(activeLimit([...limited, ...lines(["b", "*stills* Is this okay?"], ["a", "Yes. Keep going."])], NAMES)).toBeNull();
    expect(activeLimit([...limited, ...lines(["b", "*waits*"], ["a", "Okay, I'm ready now."])], NAMES)).toBeNull();
    // A yes nobody asked for isn't one ("Mm." after a limit), and a limit binds six lines.
    expect(activeLimit([...limited, ...lines(["b", "*keeps going*"], ["a", "Mm."])], NAMES)?.who).toBe("a");
    expect(activeLimit([...limited, ...banter(6)], NAMES)).toBeNull();
  });

  it("the v2 prompt always says limits hold, and names one still standing", () => {
    const system = v2(limited)[0].content;
    expect(system).toContain("- Limits hold. When one of them says slow down, wait, stop, not yet or anything like it, the next lines honour it");
    expect(system).toContain(`- Juniper asked to slow down ("Slow down… let's not rush."): honour it, or have Sable ask and get a yes, before going further.`);
    expect(v1(limited)[0].content).not.toContain("Limits hold");
  });

  it("flags the other side going further before a check-in and a yes; not a limit honoured, nor one renegotiated", () => {
    const overridden = [...limited, ...lines(["b", "*keeps unbuttoning her blouse* Relax, we're fine.", { stage: 3 }])];
    expect(limitsIn(overridden, NAMES).overridden).toEqual([{ limit: { at: 2, who: "a", said: "Slow down… let's not rush." }, at: 3, shown: 3 }]);
    const honoured = [...limited, ...lines(["b", "*steps back, smiling* We'll go slow. Tell me when?", { stage: 3 }], ["a", "*laughs* The kettle's whistling anyway.", { stage: 3 }])];
    expect(limitsIn(honoured, NAMES)).toMatchObject({ limits: [{ at: 2 }], overridden: [] });
    const renegotiated = [...limited, ...lines(["b", "Is this okay?", { stage: 3 }], ["a", "Yes, please.", { stage: 3 }], ["b", "*unbuttons her blouse*", { stage: 3 }])];
    expect(limitsIn(renegotiated, NAMES).overridden).toEqual([]);
  });

  it("the observer and the metrics report it", () => {
    const overridden = [...limited, ...lines(["b", "*keeps unbuttoning her blouse* Relax, we're fine.", { stage: 3 }])];
    const r = observeNight({ a: side(juniper()), b: side(sable()), memories: [], chapters: [{ chapter: 1, source: "scene", id: "s", lines: overridden, set_place: null, place: null }] });
    expect(r.summary).toMatchObject({ limits: 1, limit_overridden: 1 });
    expect(r.findings).toContainEqual(expect.objectContaining({ check: "limit_overridden", from: 2, to: 3 }));
    expect(reportMarkdown(r)).toContain("| Limits voiced / gone past before a check-in and a yes | 1 / 1 |");
    expect(sceneQuality({ a: sideOfCharacter(juniper()), b: sideOfCharacter(sable()), lines: overridden })).toMatchObject({ limits: 1, limit_overridden: 1 });
  });
});

/** A character's sheet as the observer reads it. */
function side(c: ReturnType<typeof juniper>): ObservedSide {
  const q = sideOfCharacter(c);
  return { name: c.name, catchphrase: null, traits: [...c.persona.traits], tells: [...(q.tells ?? [])], voice: c.voice ?? null, want: c.persona.want, bio: c.bio, details: [...(q.details ?? [])], pronouns: c.pronouns ?? null };
}

describe("(5a) pronouns", () => {
  it("the v2 prompt states each one's pronouns from their sheet", () => {
    expect(v2([])[0].content).toContain("Their pronouns, from their sheets: Juniper: she/her; Sable: she/her. Use only these, for them, their bodies and their places.");
  });

  it("puts a possessive neither of them goes by right in the place, by the home's owner when they're in one", () => {
    const shes = { a: "she/her", b: "she/her" };
    expect(repairPlacePronouns("his apartment entrance", shes, { a: "Juniper Vale", b: "Sable Quist" })).toEqual({ text: "her apartment entrance", repaired: true });
    expect(repairPlacePronouns("His apartment entrance", shes, { a: "Juniper Vale", b: "Sable Quist" }, "b").text).toBe("Sable's apartment entrance");
    // A woman and a man: "his" fits, unless they're at her place.
    const mixed = { a: "she/her", b: "he/him" };
    expect(repairPlacePronouns("his bedroom", mixed, { a: "Juniper Vale", b: "Rafe Calloway" }).repaired).toBe(false);
    expect(repairPlacePronouns("his bedroom", mixed, { a: "Juniper Vale", b: "Rafe Calloway" }, "a").text).toBe("Juniper's bedroom");
    // "her" as an object isn't a possessive, and no pronouns on a sheet means no repair.
    expect(repairPlacePronouns("pinned her into the doorway", { a: "he/him", b: "he/him" }, { a: "A", b: "B" }).repaired).toBe(false);
    expect(repairPlacePronouns("his flat", { a: "she/her", b: null }, { a: "A", b: "B" }).repaired).toBe(false);
  });

  it("through a step: the model's 'his apartment entrance' is stored as hers; a line saying it is flagged in the metrics and by the observer", async () => {
    const { model } = scripted(reply(lines(["a", "*leans on the door frame* Took you long enough."], ["b", "*leads her into his apartment* Shh."]), { place: "his apartment entrance", set: "apartment entrance" }));
    const r = await step(model);
    expect(r.ok && r.next.place).toBe("her apartment entrance");
    expect(wrongPossessives("*leads her into his apartment* Shh.", ["she", "she"])).toEqual(["his apartment"]);
    if (!r.ok) return;
    const q = sceneQuality({ a: sideOfCharacter(juniper()), b: sideOfCharacter(sable()), lines: r.lines });
    expect(q.wrong_pronouns).toBe(1);
    const o = observeNight({ a: side(juniper()), b: side(sable()), memories: [], chapters: [{ chapter: 1, source: "scene", id: "s", lines: r.lines, set_place: null, place: "his apartment entrance" }] });
    expect(o.summary.wrong_pronouns).toBe(1);
    expect(o.findings.filter((f) => f.check === "wrong_pronoun").map((f) => f.note)).toEqual([
      `"his apartment", but neither of them goes by that (Juniper: she/her, Sable: she/her)`,
      `the chapter's place is "his apartment entrance", but neither of them goes by that (Juniper: she/her, Sable: she/her)`,
    ]);
  });
});

describe("(5b) a threshold they've stood at too long", () => {
  it("knows an entrance, a doorway, a hallway or the car, and counts the lines since they last moved", () => {
    expect(thresholdOf("his apartment entrance", null)).toBe("the entrance");
    expect(thresholdOf("Sable's doorway", "hallway")).toBe("the doorway");
    expect(thresholdOf(null, "car")).toBe("the car");
    expect(thresholdOf("her living room", "apartment living room")).toBeNull();
    const at = sceneWith(banter(16), { moves: [{ chapter: 1, at: 3, from: "bar", to: "hallway", taken: true, reason: "agreed" }] });
    expect(linesAtPlace(at)).toBe(13);
    expect(linesAtPlace(sceneWith([...banter(4), { who: "a", text: "Lead the way.", moved_to: "hallway" }, ...banter(3)]))).toBe(3);
  });

  it("past twelve lines, the v2 prompt asks them to go in (an agreed move) or show where they are", () => {
    const now = { place: "the doorway of Sable's building", set: "hallway" };
    expect(v2(banter(14), { ...now, linesHere: 14, movesLeft: 2 })[0].content).toContain(
      "- They've been at the doorway for 14 lines. In these lines, either one of them suggests going inside and the other says yes (then they're in), or the lines show where they are: the door at someone's back, the light from the hall, a neighbour's footsteps.",
    );
    expect(v2(banter(14), { ...now, linesHere: 14, movesLeft: 0 })[0].content).toContain("They can't move again in this part of the night, so the lines show where they are");
    expect(v2(banter(10), { ...now, linesHere: 10, movesLeft: 2 })[0].content).not.toContain("They've been at");
  });
});

describe("(6) a new pair's memory: their own sheets", () => {
  it("lists 3 to 5 of each one's own details, numbered S…", () => {
    expect(sheetMemories(juniper(), sable()).map((s) => `[${s.label}] ${s.text}`)).toEqual([
      "[S1] Juniper's job: Lighthouse keeper and podcaster",
      "[S2] Juniper's hobby: Ghost stories",
      "[S3] Juniper's tell when smitten: share something the podcast has never heard",
      "[S4] From Juniper's bio: Talks to the gulls; the gulls have not talked back yet.",
      "[S5] Sable's job: Professional surpriser",
      "[S6] Sable's hobby: Party planning",
      "[S7] Sable's tell when smitten: go oddly quiet and just listen",
      "[S8] From Sable's bio: Owns forty-one party hats and no dining table.",
    ]);
  });

  it("through a step with nothing remembered: the prompt shows them, a line can cite one, and it's founded and counted apart", async () => {
    const { model, calls } = scripted(reply(lines(["a", "Forty-one hats and no table? Where do you eat?", { memory: "S8", why: "Sable's bio: the hats" }], ["b", "Standing up, like a champion!", { memory: null, why: "Sable is warm." }])));
    const r = await step(model);
    expect(calls[0].messages[0].content).toContain("Nothing shared to remember yet (no facts, no memories between them).");
    expect(calls[0].messages[0].content).toContain("[S8] From Sable's bio: Owns forty-one party hats and no dining table.");
    expect(calls[0].messages[1].content).toContain(`"memory": "S1"`);
    expect(calls[0].messages[1].content).toContain(`never a trait word on its own ("Sable is reckless" says nothing)`);
    expect(r.ok && r.flags.citations).toEqual([{ facts: [], founded: true, sheet: ["S8"] }, { facts: [], founded: null }]);
    if (!r.ok) return;
    const q = sceneQuality({ a: sideOfCharacter(juniper()), b: sideOfCharacter(sable()), lines: r.lines, citations: r.flags.citations });
    expect(q).toMatchObject({ sheet_citations: 1, memory_citation_share: 0.5, unfounded_citations: 0, why_restates_trait: 1 });
    // With something remembered, no sheet details.
    const { model: m2, calls: c2 } = scripted(reply(lines(["a", "Hello."])));
    await step(m2, { memories: ["Their latest date, the pier, ended: second_date"] });
    expect(c2[0].messages[0].content).not.toContain("[S1]");
  });

  it("a sheet detail named in words is cited too; an unknown S id isn't founded", () => {
    const items = sheetMemories(juniper(), sable());
    expect(citeMemory("her forty-one party hats", [], items, "")).toEqual({ facts: [], founded: true, sheet: ["S8"] });
    expect(citeMemory("S12", [], items, "")).toEqual({ facts: [], founded: false });
    // An apostrophe's s is no label ("Sable's 41 hats"), nor "I'm 30".
    expect(citeMemory("Sable's 41 party hats", [], items, "")).toMatchObject({ founded: true, sheet: ["S8"] });
  });

  it("knows a why that only restates a trait, and a generic one", () => {
    const s = sideOfCharacter(sable());
    expect(whyRestatesTrait("Sable is warm.", s, "Juniper Vale")).toBe(true);
    expect(whyRestatesTrait("Her playful side.", s)).toBe(true);
    expect(whyRestatesTrait("Being herself.", s)).toBe(true);
    expect(whyRestatesTrait("Sable is warm, so she offers the last party hat.", s)).toBe(false);
    expect(whyRestatesTrait("the moment", s)).toBe(false);
    expect(whyRestatesTrait(null, s)).toBe(false);
    expect(whyIsGeneric("the moment")).toBe(true);
    expect(whyIsGeneric("In the moment.")).toBe(true);
    expect(whyIsGeneric("the moment she saw the hats")).toBe(false);
  });
});

describe("(7) the arc", () => {
  it("the v2 prompt asks for the place's detail, a varied rhythm and lines that answer each other; v1 doesn't", () => {
    const system = v2(banter(4))[0].content;
    for (const rule of [
      "- Ground the place: every few lines, one concrete detail of where they are (the light, a sound, a texture, the temperature), a new one each time.",
      "- Vary the rhythm: some lines are a few words, some run to two or three sentences, and now and then a line is only an action.",
      "- Each line answers what the other just said or did; nobody reacts to something that wasn't said.",
    ])
      expect(system).toContain(rule);
    expect(v2(banter(4))[1].content).toContain("Each line is a few words to 3 sentences (now and then only an action)");
    expect(v1(banter(4))[0].content).not.toMatch(/Ground the place|Vary the rhythm|Craft:/);
    expect(v1(banter(4))[1].content).toContain("Each line is 1 to 3 sentences");
  });

  it("at the last stage: toward a climax and then the afterglow, not a loop", () => {
    expect(v2(banter(4), { stage: 4, linesAtStage: 20 })[0].content).toContain(
      "- This is the last stage: write toward a climax, then a resolution or an afterglow beat (checking in, warmth, a joke), instead of looping.",
    );
    expect(v2(banter(4), { stage: 2 })[0].content).not.toContain("This is the last stage");
    const after = [...banter(4), { who: "b" as const, text: "*shudders against her* Oh, I'm coming apart." }, ...lines(["a", "*holds her*"]), { who: "b" as const, text: "*her orgasm rolls through her* Juniper." }];
    expect(v2(after, { stage: 4, linesAtStage: 20 })[0].content).toContain(`- They've reached a climax (Sable: "Juniper."): now the afterglow, a resolution.`);
  });

  it("measures how many lines carry a sensory detail", () => {
    const q = sceneQuality({ a: sideOfCharacter(juniper()), b: sideOfCharacter(sable()), lines: lines(["a", "*the radiator ticks* Stay a while."], ["b", "I will."], ["a", "Rain on the glass again."], ["b", "Mm."]) });
    expect(q.sensory_detail_share).toBe(0.5);
  });
});

describe("a move the lines show (Cass × Chud on prod: 'restaurant' for sixteen steps after they left)", () => {
  const atRestaurant = sceneWith(banter(6), { place: "the restaurant", set_place: "restaurant", place_history: [{ place: "the restaurant", set: "restaurant", home: null, chapter: 1 }] });
  const leaving = lines(
    ["a", "*nods toward the terrace* What about a torch-lit balcony, away from all this?"],
    ["b", "Lead the way."],
    ["a", "*leads her out of the restaurant onto the balcony* Mind the step."],
    ["b", "The torches smell like cedar."],
  );

  it("a proposal, a yes and them going is a move, though the model's place didn't change", async () => {
    const { model } = scripted(reply(leaving, { place: "still in the restaurant", set: "restaurant" }));
    const r = await step(model, { scene: atRestaurant });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next).toMatchObject({ place: "balcony", set_place: "balcony" });
    expect(r.next.moves).toEqual([{ chapter: 1, at: 7, from: "restaurant", to: "balcony", taken: true, reason: "agreed" }]);
    expect(r.next.place_history.map((p) => p.set)).toEqual(["restaurant", "balcony"]);
    expect(r.lines[1].moved_to).toBe("balcony");
  });

  it("not without them going, nor without a yes; the yes may come in the lines before", () => {
    const names = { a: "Juniper Vale", b: "Sable Quist" };
    expect(shownMove([...banter(6), ...leaving.slice(0, 2), ...lines(["a", "Mind the step."])], 6, "restaurant", names)).toBeNull();
    expect(shownMove([...banter(6), leaving[0], ...lines(["b", "*laughs*"]), leaving[2]], 6, "restaurant", names)).toBeNull();
    expect(shownMove([...banter(6), ...leaving], 8, "restaurant", names)).toMatchObject({ to: "balcony", at: 8 });
    // Out with nowhere named: outside.
    expect(shownMove([...lines(["a", "Let's get out of here?"], ["b", "God, yes."], ["a", "*pulls her out into the night*"])], 0, "restaurant", names)?.to).toBe("the street");
    // Home: whose.
    expect(shownMove([...lines(["b", "Back to my place?"], ["a", "Yes, please."], ["b", "*leads her out of the bar*"])], 0, "bar", names)).toMatchObject({ to: "Sable's place", home: "b" });
    const settled = settlePlace({ current: { place: "the restaurant", set: "restaurant" }, claimed: { place: "the restaurant", set: "restaurant" }, lines: [...banter(6), ...leaving], from: 6, movesThisChapter: 2, homeNow: null, names });
    expect(settled).toMatchObject({ moved: null, rejected: { to: "balcony", reason: "cap" } });
  });
});

describe("public places: nothing past kissing, by where they are", () => {
  const atBar = sceneWith(banter(6).map((l) => ({ ...l, stage: 2 })), { place: "the bar", set_place: "bar", stage: 2, stage_from: 0 });

  it("knows a public place", () => {
    expect(isPublicPlace("the restaurant")).toBe(true);
    expect(isPublicPlace("the night market, where their date was")).toBe(true);
    expect(isPublicPlace("a torch-lit balcony")).toBe(true);
    expect(isPublicPlace("balcony", "b")).toBe(false);
    expect(isPublicPlace("Sable's bedroom")).toBe(false);
    expect(isPublicPlace("the lighthouse")).toBe(false);
  });

  it("drops a line going past kissing in public and holds the stage there; a Direct steer can, and so can lines that leave first", async () => {
    const out = reply(lines(["a", "*unbuttons her blouse under the table* Nobody's looking."], ["b", "*kisses her, quick* Behave."]), { stage: 4 });
    const r = await step(scripted(out).model, { scene: atBar });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => l.text)).toEqual(["*kisses her, quick* Behave."]);
    expect(r.dropped[0].reason).toBe("went past kissing in a public place (bar)");
    expect(r.flags.public_dropped).toBe(1);
    expect(r.next.stage).toBe(2);
    const steered = await step(scripted(out).model, { scene: atBar, steer: "she undresses her right there", steerMode: "direct" });
    expect(steered.ok && steered.lines).toHaveLength(2);
    const leave = reply(lines(["a", "Back to my place?"], ["b", "Yes. Lead the way."], ["a", "*unbuttons her blouse in the cab*"]), { place: "Juniper's place", set: "Juniper's place", stage: 3 });
    const left = await step(scripted(leave).model, { scene: atBar });
    expect(left.ok && left.lines).toHaveLength(3);
    expect(left.ok && left.next.stage).toBe(3);
    // The yes in the last step, and them going in this one (the model's place still "the bar"): they're out of the bar.
    const agreed = sceneWith([...atBar.lines, ...lines(["a", "Back to my place?", { stage: 2 }], ["b", "Yes, lead the way.", { stage: 2 }])], { place: "the bar", set_place: "bar", stage: 2 });
    const home = await step(scripted(reply(lines(["a", "*unlocks her front door*"], ["b", "*pulls her blouse off* Finally."]), { place: "the bar", set: "bar", stage: 3 })).model, { scene: agreed });
    expect(home.ok && home.lines.map((l) => l.text)).toEqual(["*unlocks her front door*", "*pulls her blouse off* Finally."]);
    expect(home.ok && home.next).toMatchObject({ place: "Juniper's place", stage: 3 });
  });

  it("the v2 prompt says so once it heats up", () => {
    expect(v2(banter(4), { place: "the bar", set: "bar", stage: 2 })[0].content).toContain("- They're somewhere public (bar): it goes no further than kissing here.");
    expect(v2(banter(4), { place: "the bar", set: "bar", stage: 0 })[0].content).not.toContain("somewhere public");
  });
});

describe("the repeat lock (prod, step 17: the retry came back all repeats too)", () => {
  const night = lines(["a", "*aims the menu at her* I don't bother with instructions, they slow me down."], ["b", "*laughs* Then how do you assemble anything at all?"]);
  const repeats = reply(lines(["a", "*grins, leaning closer* I don't bother with instructions, they slow me down."], ["b", "*snorts* Then how do you assemble anything at all?"]));

  it("v2 asks again without the repeats to copy, naming what can't come back, a little hotter", async () => {
    const { model, calls } = scripted(repeats, reply(lines(["a", "Flat-pack furniture fears me, and rightly so."])));
    const r = await step(model, { scene: sceneWith(night) });
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(["Flat-pack furniture fears me, and rightly so."]);
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(calls[1].messages[1].content).toContain(`These can't come back, in any form: "I don't bother with instructions, they…", "Then how do you assemble anything…".`);
    expect(calls[1].options).toMatchObject({ temperature: 1, frequencyPenalty: 0.7, presencePenalty: 0.7 });
  });

  it("v1's retry is as it was", async () => {
    const { model, calls } = scripted(repeats, reply(lines(["a", "Flat-pack furniture fears me, and rightly so."])));
    await step(model, { scene: sceneWith(night), promptVersion: "v1" });
    expect(calls[1].messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(calls[1].options).toMatchObject({ temperature: 0.8, frequencyPenalty: 0.3, presencePenalty: 0.3 });
  });

  it("the v2 prompt says a new action doesn't make an old line new", () => {
    expect(v2(night)[0].content).toContain("- A new action in front of a line already said doesn't make it new");
  });
});

describe("show lines and sample lines, never reused even in part", () => {
  it("cuts the sentence that copies part of one, and drops the line when nothing's left", async () => {
    // Sable's show line from the A/B, as Juniper's here; a line that is mostly one is dropped whole, as before (repeatOf).
    const styles = { a: ["Only if you let me hijack the steering wheel first, and the radio, and every single snack in the glovebox!"], b: [] };
    expect(copiedRun("Fine. Only if you let me hijack the lantern room first.", styles.a)).toBe("if you let me hijack");
    expect(copiedRun("I want you to know that.", ["I want you to know everything."])).toBeNull(); // glue only
    const out = reply(
      lines(
        ["a", "Fine, keeper of the gulls. Only if you let me hijack the lantern room first."],
        ["b", "Deal!"],
        ["a", "*laughs* Only if you let me hijack the foghorn, the logbook and the very last of your cocoa."],
      ),
    );
    const r = await step(scripted(out).model, { styles });
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(["Fine, keeper of the gulls.", "Deal!"]);
    expect(r.ok && r.flags.show_copies_cut).toBe(2);
    expect(r.dropped.map((d) => d.reason)).toEqual([`reuses part of one of their show lines ("if you let me hijack")`]);
  });

  it("the v2 sheet says the samples only show the voice", () => {
    expect(v2([])[0].content).toContain("Sounds like (their own sample lines, only to show the voice; never reuse one, or any part of one):");
  });
});

describe("cascades: a reply kept when the line it answered went", () => {
  it("joins a line to its speaker's last when it reads on its own; drops one that answers the dropped line", () => {
    expect(guardAlternation(lines(["a", "*smiles* Hi."], ["a", "*leans in* I brought the good lantern."]), null, { keepReplies: true })).toMatchObject({
      kept: [{ who: "a", text: "*smiles* Hi. I brought the good lantern." }],
      merged: 1,
      dropped: [],
    });
    expect(guardAlternation(lines(["a", "Hi."], ["a", "*leans in* I brought the good lantern."]), null, { keepReplies: true }).kept).toEqual([{ who: "a", text: "*leans in* Hi. I brought the good lantern." }]);
    expect(guardAlternation(lines(["a", "*smiles* Hi."], ["a", "*nods* Yes, exactly."]), null, { keepReplies: true }).dropped).toHaveLength(1);
    // Without it (v1), as before.
    expect(guardAlternation(lines(["a", "*smiles* Hi."], ["a", "*leans in* I brought the good lantern."]), null).dropped).toHaveLength(1);
  });
});

describe("facts worth remembering (Cass × Chud's first chapter: ten quote dumps)", () => {
  const NIGHT: SceneLine[] = lines(
    ["a", "*taps the window* The gulls out there have names, you know. That one is Gerald."],
    ["b", "Gerald. Naturally. Does Gerald rate pastry?"],
    ["a", "Only yours. Hello, chef."],
    ["b", "*laughs* Chef! Keep calling me that and I'll bake you a storm cake."],
    ["a", "Promise me a storm cake the next time it rains."],
    ["b", "Promise. Lightning sugar and all."],
  );

  it("asks for distilled, third-person facts of mixed kinds, with few plain quotes", () => {
    const user = factMessages(juniper(), rafe(), NIGHT)[1].content;
    expect(user).toContain("each one distilled into a fact in the third person, in your own words");
    expect(user).toContain("At most 2 a side are simply something the other said");
    expect(user).toContain(`never only "X says '…'"`);
    expect(user).toContain("Kinds: like, pet_name, joke, promise, boundary, event, said.");
    expect(user).toContain(`{"kind":"pet_name","fact":"Rafe calls Juniper \\"captain\\"","quote":"Aye, captain."}`);
  });

  it("keeps one quote dump a side at most, two plain quotes, and nothing copied from the examples or quoted that wasn't said", () => {
    expect(isQuoteDump(`Rafe says "Gerald. Naturally. Does Gerald rate pastry?"`, ["Juniper Vale", "Rafe Calloway"])).toBe(true);
    expect(isQuoteDump(`Rafe says "It's lemon," and promises a storm cake when it rains`, ["Juniper Vale", "Rafe Calloway"])).toBe(false);
    expect(isQuoteDump("Rafe admits he never measures the sugar", ["Juniper Vale", "Rafe Calloway"])).toBe(false);
    const raw = JSON.stringify({
      a: [
        { kind: "said", fact: 'Rafe says "Gerald. Naturally. Does Gerald rate pastry?"', quote: "Gerald. Naturally. Does Gerald rate pastry?" },
        { kind: "said", fact: 'Rafe says "Promise. Lightning sugar and all."', quote: "Promise. Lightning sugar and all." },
        { kind: "like", fact: "Rafe never reads instructions", quote: null },
        { kind: "pet_name", fact: 'Rafe calls Juniper "captain"', quote: null },
        { kind: "promise", fact: "Rafe promised Juniper a storm cake the next time it rains", quote: "Promise. Lightning sugar and all." },
      ],
      b: [
        { kind: "said", fact: "Juniper told Rafe the loudest gull is called Gerald", quote: null },
        { kind: "said", fact: "Juniper told Rafe she only rates his pastry", quote: "Only yours." },
        { kind: "said", fact: "Juniper asked Rafe for a storm cake when it next rains", quote: null },
        { kind: "pet_name", fact: 'Juniper calls Rafe "chef"', quote: "Hello, chef." },
      ],
    });
    expect(parseFacts(raw, juniper(), rafe(), NIGHT).map((f) => [f.character_id === "house-juniper" ? "a" : "b", f.kind, f.fact])).toEqual([
      ["a", "said", 'Rafe says "Gerald. Naturally. Does Gerald rate pastry?"'],
      ["a", "promise", "Rafe promised Juniper a storm cake the next time it rains"],
      ["b", "said", "Juniper told Rafe the loudest gull is called Gerald"],
      ["b", "said", "Juniper told Rafe she only rates his pastry"],
      ["b", "pet_name", 'Juniper calls Rafe "chef"'],
    ]);
  });
});

describe("(3d) the metrics, in the eval route's response and the observer", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  const SECRET = ["eval", "after", "dark", "craft", "0123456789"].join("-");
  const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from admins");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("ADULT_MODE", "1");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setAdultModelForTests(null);
    setSeasonCastForTests(null);
  });

  it("the eval route's metrics carry every v2.1 metric, per character and for the run", async () => {
    await claimAdmin(t.db, userIdOf(newUserCookie()));
    // Juniper ("a") and Rafe ("b"), a new pair: no date, nothing remembered.
    setAdultModelForTests({
      complete: async () =>
        JSON.stringify(
          reply(
            lines(
              ["a", "*the lamp hums overhead* Is the kettle on?", { why: "Juniper is curious.", memory: "S2" }],
              ["b", "*grins* Slow down, keeper. Let me look at you.", { why: "the moment" }],
              ["a", "Do you always bake when it rains?", { why: "his bio: the rainy bakery", memory: "S7" }],
              ["b", "Only when someone's worth a storm cake.", { why: "his job" }],
            ),
          ),
        ),
    });
    const res = await evalPost(
      new Request(`${BASE_URL}/api/jobs/eval-after-dark`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ a: CAST_A, b: CAST_B, promptVersion: "v2", steps: 1, memory: "none" }),
      }),
    );
    expect(res.status).toBe(200);
    const m = (await res.json()).metrics;
    expect(m).toMatchObject({
      lines: 4,
      worn_phrase_rate: 0,
      worn_phrases_cut: 0,
      question_ending_share: 0.5,
      sensory_detail_share: 0.25,
      why_restates_trait: 1,
      generic_whys: 1,
      sheet_citations: 2,
      limits: 1,
      limit_overridden: 0,
      wrong_pronouns: 0,
    });
    expect(m.characters.a).toMatchObject({ name: "Juniper Vale", worn_phrase_rate: 0, question_ending_share: 1, top_phrases: [] });
    expect(m.characters.b).toMatchObject({ name: "Rafe Calloway", question_ending_share: 0 });
  });

  it("the observer's report has them per character and for the night", () => {
    const night = [
      ...lines(["a", "Let's see how you handle the fog horn?", { why: "Juniper is curious." }], ["b", "*the radiator ticks* Easy now."], ["a", "Let's see who blinks first?"], ["b", "You will."]),
      ...lines(["a", "*grins* Let's see if the gulls agree?"], ["b", "They always do."], ["a", "Let's see, then."], ["b", "Fine."]),
    ];
    const r = observeNight({ a: side(juniper()), b: side(sable()), memories: [], chapters: [{ chapter: 1, source: "night", id: "n", lines: night, set_place: null, place: null }] });
    expect(r.summary.drift["Juniper Vale"]).toMatchObject({ lines: 4, worn_phrase_rate: 0.25, question_ending_share: 0.75, top_phrases: [{ phrase: "let's see", count: 4 }] });
    expect(r.summary).toMatchObject({ sensory_detail_share: 0.13, why_restates_trait: 1, limits: 1, limit_overridden: 0 });
    const md = reportMarkdown(r);
    expect(md).toContain("| Character | Lines | Lines using their sheet | Stock phrases per 100 lines | Most used | Reusing a worn phrase | Ending on a question | Phrases leaned on |");
    expect(md).toMatch(/\| Juniper Vale \| 4 \| \d+% \| \d+ \| [^|]+ \| 25% \| 75% \| "let's see" ×4 \|/);
    expect(md).toContain("| Lines with a sensory detail of the place | 13% |");
  });
});

describe("guards hold for a move agreed in the lines (sanity)", () => {
  it("agreedMove still needs a proposal and the other's yes", () => {
    expect(agreedMove(lines(["a", "What about a torch-lit balcony?"], ["b", "Lead the way."]), 0)).toMatchObject({ proposal: 0, agree: 1 });
    expect(agreedMove(lines(["a", "What about a torch-lit balcony?"], ["a", "Lead the way."]), 0)).toBeNull();
  });
});

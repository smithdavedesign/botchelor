import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AfterDarkTheater from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import { assembleCharacter } from "@/lib/character";
import { closestSet } from "@/lib/adult/continuity";
import { possessiveNames } from "@/lib/adult/craft";
import { citeMemory, usesFact, type AdultFact, type ShownFact } from "@/lib/adult/facts";
import { rememberAfterDark } from "@/lib/adult/memory";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { actionRepeatOf, buildUpIn, flaggedHooks, hookAllowance, hooksOf, openingRepeatOf, sceneQuality, showsTell, sideOfCharacter, touchesHook, whyIsGeneric } from "@/lib/adult/quality";
import { dropRepeats, emptyScene, recapFallback, recapFrom, sceneMessages, writeRecap, writeSceneStep, type SceneLine, type SceneState, type StepInput } from "@/lib/adult/scenes";
import type { Db } from "@/lib/db";
import type { CharacterRef } from "@/lib/game";
import type { ChatMessage, Model, ModelOptions } from "@/lib/model";
import { drawLabel } from "@/lib/sets";
import { houseCharacter } from "./after-dark-prompt-cases";

// Prompt v2.2 (Lexi × Dex on prod, 2026-10-22: 3 chapters, about 298 lines, chapter 3 written after v2.1 went live): a
// stale recap, pie in 137 lines and pottery in 73, her pencil-spinning tell 31 times (during sex too), the same action
// twice, the same opening twice, "almost there" three times, fragment whys, loose fact citations, and "Lexis bedroom".

/** Lexi, a baker with a pencil-spinning tell (she/her), and Dex Okafor, the house's retired stuntman who teaches pottery. */
const lexi = () =>
  assembleCharacter({
    id: "lexi-1",
    sheet: {
      name: "Lexi",
      age: 29,
      bio: "Runs a pie stand at the farmers' market and enters every county bake-off going.",
      traits: ["bold", "playful", "stubborn"],
      want: "Someone who'll taste-test at midnight",
      dealbreaker: "Store-bought crust",
      house: false,
      pronouns: "she/her",
      voice: "Quick and teasing, with a laugh that comes before the joke.",
    },
    soul: null,
    memory: null,
    extras: { occupation: "Pie baker", hobbies: ["Bake-offs"], tells: { nervous: "spin a pencil", smitten: "hum off-key", bored: "count the ceiling tiles", annoyed: "get very polite" } },
  });
const dex = () => houseCharacter("house-dex");
const PAIR = { a: { id: "house-dex", name: "Dex Okafor" }, b: { id: "lexi-1", name: "Lexi" } };
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
const lines = (...xs: ([("a" | "b"), string] | [("a" | "b"), string, Record<string, unknown>])[]): SceneLine[] => xs.map(([who, text, extra]) => ({ who, text, ...(extra ?? {}) }));
const reply = (xs: SceneLine[], extra: Record<string, unknown> = {}) => ({ lines: xs.map((l) => ({ why: "She wants to see him laugh again.", memory: null, ...l })), ...extra });
/** One step of a Dex × Lexi scene, v2 unless asked otherwise. */
const step = (model: Model, over: Partial<StepInput> = {}) =>
  writeSceneStep({
    model,
    a: dex(),
    b: lexi(),
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
const prompt = (night: SceneLine[], now: Record<string, unknown> = {}) =>
  sceneMessages(dex(), lexi(), null, night, null, PAIR.a.id, { place: "her bedroom", stage: 4, linesAtStage: 20, opening: false, promptVersion: "v2", ...now } as never);

/** Dex's side of the talk: varied, about nothing the tests look for. */
const DEX = [
  "The fog's lifting off the field.",
  "I knocked on the dashboard twice for luck.",
  "My truck has a heater that only works on Tuesdays.",
  "You laugh like a kettle about to boil.",
  "I fell off a moving train once. On purpose.",
  "The radio only gets the farm report.",
  "There's a blanket behind the seat, somewhere.",
  "I'm told I hum when I drive.",
  "Nineteen times on fire, and still no tan.",
  "Your hands are freezing, come here.",
];
const LEXI = [
  "You brought a thermos? Marry me.",
  "My boots are soaked through.",
  "I counted forty fence posts on the way.",
  "That cow has been staring at us for an hour.",
  "Tell me about the train.",
  "I lost a bake-off to a man named Gus once.",
  "The windows are fogging up.",
  "You drive like my grandmother.",
  "I can't feel my toes, Dex.",
  "Who taught you to fold a map like that?",
];
const banter = (n: number, offset = 0): SceneLine[] =>
  Array.from({ length: n }, (_, i) => ({ who: i % 2 ? "b" : "a", text: (i % 2 ? LEXI : DEX)[(Math.floor(i / 2) + offset) % 10] }) as SceneLine);

describe("(1) a recap that keeps up (chapter 2 carried chapter 1's recap word for word)", () => {
  afterEach(() => {
    setAdultModelForTests(null);
    vi.restoreAllMocks();
  });
  const before = "Lexi and Dex have been in a truck in the fog. Dex has been hesitant, and Lexi teased him about it.";
  const end = { chapter: 2, place: "on the bed", set_place: "Lexi's bedroom", stage: 4 };
  const night = banter(12);

  it("reads the recap in a code fence, or after a sentence", () => {
    expect(recapFrom('```json\n{"recap": "They left the truck for her bedroom."}\n```')).toEqual({ recap: "They left the truck for her bedroom." });
    expect(recapFrom('Here is the recap:\n{"recap": "They left the truck for her bedroom."}')).toEqual({ recap: "They left the truck for her bedroom." });
    expect(recapFrom("They left the truck for her bedroom.")).toEqual({ reason: "the reply had no JSON object in it" });
    expect(recapFrom('{"summary": "They left the truck."}')).toEqual({ reason: "the reply's JSON had no recap in it" });
    expect(recapFrom('{"recap": "She was a schoolgirl once, he says."}')).toEqual({ reason: "the recap crossed one of the two lines" });
  });

  it("through writeRecap: a fenced reply is the new recap", async () => {
    setAdultModelForTests(scripted('```json\n{"recap": "They left the truck for her bedroom, and he stopped hesitating."}\n```').model);
    expect(await writeRecap({} as Db, dex(), lexi(), before, night, end)).toBe("They left the truck for her bedroom, and he stopped hesitating.");
  });

  it("a reply it can't use never leaves the recap stale: the last one, with where the chapter ended and how far it went; the log says why, never what", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setAdultModelForTests(scripted("*Dex pulls her closer* Mm, where were we? Nothing to summarise.").model);
    expect(await writeRecap({} as Db, dex(), lexi(), before, night, end)).toBe(`${before} Later, at Lexi's bedroom, it went as far as sex.`);
    expect(warn).toHaveBeenCalledWith("[after-dark] chapter 2's recap: the reply had no JSON object in it; kept the last one and added where the chapter ended");
    setAdultModelForTests({
      complete: async () => {
        throw new Error("model returned HTTP 429 (Rate limit exceeded)");
      },
    });
    expect(await writeRecap({} as Db, dex(), lexi(), null, night, { ...end, chapter: 1 })).toBe("At Lexi's bedroom, it went as far as sex.");
    expect(warn).toHaveBeenLastCalledWith("[after-dark] chapter 1's recap: the model didn't answer (model returned HTTP 429 (Rate limit exceeded)); kept the last one and added where the chapter ended");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("Dex pulls her closer");
  });

  it("the PG note written at the same close reads a fenced reply too, instead of falling back", async () => {
    const stored: unknown[][] = [];
    const db = { query: async (_sql: string, params: unknown[] = []) => (stored.push(params), { rows: [] }) } as unknown as Db;
    setAdultModelForTests(scripted('```json\n{"a": "You and Lexi left the fog for her place; you still owe her a pie.", "b": "You and Dex left the fog together; he knocked on wood twice."}\n```').model);
    await rememberAfterDark(db, "owner", dex(), lexi(), before, night);
    expect(stored.map((p) => p[3])).toEqual(["You and Lexi left the fog for her place; you still owe her a pie.", "You and Dex left the fog together; he knocked on wood twice."]);
  });

  it("the fallback keeps the newest under RECAP_MAX, says a place's own preposition, and leaves out a place over the two lines", () => {
    const long = Array.from({ length: 80 }, (_, i) => `In chapter ${i} they talked about pie.`).join(" ");
    const r = recapFallback(long, end);
    expect(r.length).toBeLessThanOrEqual(1200);
    expect(r.endsWith("Later, at Lexi's bedroom, it went as far as sex.")).toBe(true);
    expect(r).not.toContain("In chapter 0 ");
    expect(recapFallback(null, { place: "outside the truck, in the fog", set_place: null, stage: 2 })).toBe("Outside the truck, in the fog, it went as far as kissing.");
    expect(recapFallback(null, { place: null, set_place: "street", stage: 0 })).toBe("At the street, it went as far as talking and flirting.");
    expect(recapFallback("Before.", { place: null, set_place: "the schoolgirl dorm", stage: 1 })).toBe("Before. Later, it went as far as tension and the first touches.");
  });
});

describe("(2) hooks: a flagged theme held to one line in six this chapter (pie in 137 of 298 lines)", () => {
  // Lexi's six lines this chapter: pie in four of them, so "pie" is flagged (three letters is enough now).
  const PIE = ["This pie needed more lattice.", "The pie tin is still warm.", "Nobody rushes a pie, Dex.", "Pie for breakfast is a human right."];
  const night: SceneLine[] = [0, 1, 2, 3, 4, 5].flatMap((i) => lines(["a", DEX[i]], ["b", i < 4 ? PIE[i] : LEXI[i]]));

  it("reads 'pie' as a hook, as itself only ('piece' isn't it), and holds one flagged once", () => {
    expect(hooksOf(night, "b", NAMES)).toEqual([{ word: "pie", stem: "pie", lines: 4, of: 6 }]);
    expect(touchesHook("A piece of the pier.", { stem: "pie" })).toBe(false);
    expect(touchesHook("Two pies, then.", { stem: "pie" })).toBe(true);
    // Ten plain lines of hers later "pie" is under the flag again, but it was flagged tonight, so it's still held.
    const later = [...night, ...banter(20, 3)];
    expect(hooksOf(later, "b", NAMES)).toEqual([]);
    expect(flaggedHooks(later, "b", NAMES).map((h) => h.word)).toEqual(["pie"]);
    expect([5, 6, 11, 12, 30].map(hookAllowance)).toEqual([1, 1, 2, 2, 5]);
  });

  it("through a step: past its share the sentence with it goes, and the line when nothing's left; v1 keeps them", async () => {
    const out = reply(lines(["a", "Your flour handprint is still on my jacket."], ["b", "*wipes her hands* The pie can wait. Kiss me."], ["a", "Gladly."], ["b", "Pie first, though."]));
    const r = await step(scripted(out).model, { scene: sceneWith(night) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => l.text)).toEqual(["Your flour handprint is still on my jacket.", "*wipes her hands* Kiss me.", "Gladly."]);
    expect(r.dropped).toEqual([{ who: "b", text: "Pie first, though.", reason: `a theme past its share this chapter ("pie", in 4 of their 7 lines)` }]);
    expect(r.flags.hooks_cut).toBe(2);
    const old = await step(scripted(out).model, { scene: sceneWith(night), promptVersion: "v1" });
    expect(old.ok && old.lines.map((l) => l.text)).toContain("Pie first, though.");
  });

  it("the v2 prompt's hook note says so", () => {
    expect(prompt(night, { stage: 1 })[0].content).toContain(`- Lexi keeps coming back to "pie" (4 of her last 6 lines).`);
    expect(prompt(night, { stage: 1 })[0].content).toContain(`"pie" now gets one of her lines in 6 at most; a line past that loses it.`);
  });

  it("the v2 voice rule asks for their job or a hobby now and then, not in every line", () => {
    const [system, user] = prompt([]).map((m) => m.content);
    expect(system).toContain("their humour and the way they talk still show, and their job or a hobby comes up now and then, not in every line");
    expect(user).toContain("their humour and their way of talking keep showing, their work or a hobby now and then (not in every line)");
    expect(user).not.toContain("their tells keep showing");
  });
});

describe("(2b) tells: twice a chapter, and not for the explicit stages (her pencil, 31 times)", () => {
  const spun = lines(["a", DEX[0]], ["b", "*spins a pencil* So. The truck."], ["a", DEX[1]], ["b", "*spins her pencil faster* Don't look at me like that."]);

  it("knows a tell by its own words, most of them", () => {
    expect(showsTell("*spins her pencil between two fingers*", "spin a pencil")).toBe(true);
    expect(showsTell("*taps a pencil on the dash*", "spin a pencil")).toBe(false);
    expect(showsTell("*counts the ceiling tiles out loud*", "count the ceiling tiles")).toBe(true);
  });

  it("past twice this chapter what shows it goes: the action, or the line when that was all", async () => {
    const out = reply(lines(["a", "You're staring at my hands."], ["b", "*spins her pencil* You're staring at mine."], ["a", "Guilty."], ["b", "*spins the pencil again, faster*"]));
    const { model, calls } = scripted(out);
    const r = await step(model, { scene: sceneWith(spun, { stage: 1 }) });
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(["You're staring at my hands.", "You're staring at mine.", "Guilty."]);
    expect(r.ok && r.flags.tells_cut).toBe(2);
    expect(r.dropped.map((d) => d.reason)).toEqual([`a tell past 2 lines this chapter ("spin a pencil")`]);
    // The prompt named it, like a catchphrase that's had its once.
    expect(calls[0].messages[0].content).toContain("- Lexi has shown her tell (spin a pencil) twice this chapter: not again.");
  });

  it("from undressing on, the v2 prompt says tells are for the talking; before it, nothing", () => {
    expect(prompt(banter(4), { stage: 3 })[0].content).toContain("- Their tells (the habits on their sheets) are for the talking: now it's gone this far they don't show, unless one truly fits the moment.");
    expect(prompt(banter(4), { stage: 2 })[0].content).not.toContain("are for the talking");
  });

  it("measures each one's hook and tell uses, and tells at the explicit stages", () => {
    const measured = [...lines(["b", "*spins a pencil* Pie?", { stage: 1 }], ["a", "Sure.", { stage: 1 }], ["b", "Pie is love.", { stage: 2 }], ["a", "Agreed.", { stage: 2 }])];
    const q = sceneQuality({
      a: sideOfCharacter(dex()),
      b: sideOfCharacter(lexi()),
      lines: [...measured, ...lines(["b", "*spins her pencil* Pie again.", { stage: 4 }], ["a", "Mm.", { stage: 4 }], ["b", "More pie.", { stage: 4 }], ["a", "Yes.", { stage: 4 }], ["b", "Pie, Dex.", { stage: 4 }], ["a", "Okay.", { stage: 4 }], ["b", "Fine.", { stage: 4 }])],
    });
    expect(q.characters.b).toMatchObject({ hook: { word: "pie", share: 0.83 }, tell_uses: 2 });
    expect(q).toMatchObject({ tell_uses: 2, tell_uses_explicit: 1 });
  });
});

describe("(3) repeated actions and openings (lines 36 and 38: the same action; 37 and 39: the same opening)", () => {
  const PACE = "*Increases his pace, growing larger inside her*";
  const night = [...banter(4), ...lines(["a", `${PACE} God, Lexi.`, { stage: 4 }], ["b", "Oh god, don't stop, Dex, please.", { stage: 4 }])];
  const cut = (written: SceneLine[], at = night) => dropRepeats(written, at, at, dex(), lexi(), { worn: true, craft: true });

  it("knows the same action again, word for word or nearly; never a short one, nor a different one", () => {
    expect(actionRepeatOf("Increases his pace, growing larger inside her", ["Increases his pace, growing larger inside her"])).not.toBeNull();
    expect(actionRepeatOf("increases his pace again, growing harder inside her", ["Increases his pace, growing larger inside her"])).not.toBeNull();
    expect(actionRepeatOf("grins", ["grins"])).toBeNull();
    expect(actionRepeatOf("runs his hands up her thighs", ["runs his hands down her back"])).toBeNull();
    expect(openingRepeatOf("Oh god, don't stop. Harder.", ["Oh god, don't stop, Dex, please."])).toBe("oh god don't stop");
    expect(openingRepeatOf("I want you to stay.", ["I want you to know."])).toBeNull();
  });

  it("an action from the last ten lines goes and what they say stays; a line that was only it goes", () => {
    const r = cut(lines(["b", "Don't you dare slow down."], ["a", `${PACE} You feel like home.`], ["b", "Dex."], ["a", "*increases his pace again, growing harder inside her*"]));
    expect(r.kept.map((l) => l.text)).toEqual(["Don't you dare slow down.", "You feel like home.", "Dex."]);
    expect(r.dropped.map((d) => d.reason)).toEqual([`the same action again ("Increases his pace, growing larger inside her")`]);
    expect(r.cuts.actions).toBe(2);
    // Ten lines on, it's new again.
    const later = [...night, ...banter(10, 4)];
    expect(cut(lines(["a", `${PACE} Again.`]), later).kept.map((l) => l.text)).toEqual([`${PACE} Again.`]);
  });

  it("an opening from the last four lines can't be rephrased, so its sentence goes, and the line when nothing's left", () => {
    const r = cut(lines(["a", "Look at me."], ["b", "Oh god, don't stop. Harder, Dex, harder."], ["a", "*holds her hips*"], ["b", "Oh god, don't stop, please, please."]));
    expect(r.kept.map((l) => l.text)).toEqual(["Look at me.", "Harder, Dex, harder.", "*holds her hips*"]);
    expect(r.dropped.map((d) => d.reason)).toEqual([`opens like a line just said ("oh god don't stop")`]);
    expect(r.cuts.openings).toBe(2);
  });

  it("v1 (no craft guards) keeps them all", () => {
    const written = lines(["b", "Oh god, don't stop. Harder, Dex, harder."], ["a", `${PACE} You feel like home.`]);
    expect(dropRepeats(written, night, night, dex(), lexi()).kept.map((l) => l.text)).toEqual(written.map((l) => l.text));
  });
});

describe("(4) continuity and the arc (sex resumed after aftercare; eyes locked from behind; 'almost there' three times)", () => {
  const close = [...banter(4), ...lines(["b", "*grips the sheets* Almost there, Dex.", { stage: 4 }], ["a", "*holds her hips* Stay with me.", { stage: 4 }])];

  it("knows the build-up out loud, not someone being near", () => {
    expect(buildUpIn("Almost there, Dex.")).toBe("almost there");
    expect(buildUpIn("I'm so close.")).toBe("i'm so close");
    expect(buildUpIn("*pulls him so close*")).toBeNull();
    expect(buildUpIn("I want you so close to me.")).toBeNull();
  });

  it("the build-up again from the same speaker within ten lines loses its sentence; the other one, or later, keeps it", () => {
    const r = dropRepeats(lines(["b", "So close. Don't you dare stop."], ["a", "I'm close too."], ["b", "Almost there!"]), close, close, dex(), lexi(), { worn: true, craft: true });
    expect(r.kept.map((l) => l.text)).toEqual(["Don't you dare stop.", "I'm close too."]);
    expect(r.dropped.map((d) => d.reason)).toEqual([`the build-up again ("almost there")`]);
    expect(r.cuts.build_ups).toBe(2);
    const later = [...close, ...banter(10, 2)];
    expect(dropRepeats(lines(["b", "So close."]), later, later, dex(), lexi(), { craft: true }).kept).toHaveLength(1);
  });

  it("the v2 prompt keeps their positions from undressing on, says the build-up once, and starts it again only on a line", () => {
    const system = prompt(banter(4))[0].content;
    expect(system).toContain("- Keep track of how they're positioned: once a line sets it (on top, from behind, against the wall), the lines only show what each of them could see, reach or do from there (from behind, their eyes don't meet), until a line changes it.");
    expect(system).toContain(`The build-up ("almost there", "so close") is said once, not again and again: then the climax comes.`);
    expect(system).toContain("After an afterglow or aftercare it only picks up again when one of them starts it in a line (asks, or reaches for the other) and the other answers; it never just resumes.");
    const after = [...banter(4), ...lines(["b", "*her orgasm rolls through her* Dex."], ["a", "*holds her, catching his breath*"])];
    expect(prompt(after)[0].content).toContain(`now the afterglow, a resolution. They check in with each other, stay warm, make each other laugh; it doesn't start over unless one of them starts it in a line (asks, or reaches for the other) and the other answers.`);
    expect(prompt(banter(4), { stage: 2 })[0].content).not.toContain("how they're positioned");
  });
});

describe("(5) loose citations and fragment whys (F13, F14 and F5 on lines that don't use them; 'The climax, the shared moment')", () => {
  const fact = (id: string, label: string, text: string, quote: string | null = null): ShownFact => ({
    label,
    fact: { id, character_id: "lexi-1", other_id: "house-dex", kind: "like", fact: text, quote, source: "after_dark", created_at: "2026-10-21T00:00:00.000Z", last_used_at: null, uses: 0 } as AdultFact,
  });
  const shown = [fact("f13", "F13", "Dex teaches pottery on Sundays"), fact("f5", "F5", "Lexi calls Dex 'trouble'", "Hello, trouble.")];
  const others = [{ label: "M1", text: "Their latest date, the county fair, ended: second_date" }];
  const line = (text: string) => ({ text, names: NAMES });

  it("a cited fact must share a distinctive word with the line, else it's loose: not founded, not one of its facts", () => {
    expect(usesFact("Those pottery hands of yours.", shown[0].fact, NAMES)).toBe(true);
    expect(usesFact("*arches against him* Dex—", shown[0].fact, NAMES)).toBe(false);
    expect(citeMemory("F13", shown, others, "", line("*arches against him* Dex—"))).toEqual({ facts: [], founded: false, loose: ["f13"] });
    expect(citeMemory("F13", shown, others, "", line("Those pottery hands of yours."))).toEqual({ facts: ["f13"], founded: true });
    expect(citeMemory("F13 and F5", shown, others, "", line("Hello again, trouble."))).toEqual({ facts: ["f5"], founded: true, loose: ["f13"] });
    expect(citeMemory("F13, M1", shown, others, "", line("*arches*"))).toEqual({ facts: [], founded: true, loose: ["f13"] });
    // An id that isn't there is the worse fault: unfounded, loose facts or not. Without the line, as before.
    expect(citeMemory("F13, F99", shown, others, "", line("*arches*"))).toEqual({ facts: [], founded: false });
    expect(citeMemory("F13", shown, others, "")).toEqual({ facts: ["f13"], founded: true });
  });

  it("through a step: the loose fact isn't on the line (so never bumped), and the metrics count it apart", async () => {
    // The step numbers the pair's facts itself (lib/adult/facts.ts factLabels, oldest first, then by id): f13 is F1, f5 is F2.
    const out = reply(lines(["a", "*holds her close* Lexi.", { memory: "F1", why: "He wants her to know he's here." }], ["b", "Hello again, trouble.", { memory: "F2", why: "She calls him trouble when he's sweet." }]));
    const { model, calls } = scripted(out);
    const r = await step(model, { facts: shown.map((s) => s.fact) });
    expect(calls[0].messages[0].content).toContain("[F1] Dex teaches pottery on Sundays");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => l.fact_ids ?? null)).toEqual([null, ["f5"]]);
    expect(r.flags.citations[0]).toEqual({ facts: [], founded: false, loose: ["f13"] });
    const q = sceneQuality({ a: sideOfCharacter(dex()), b: sideOfCharacter(lexi()), lines: r.lines, citations: r.flags.citations });
    expect(q).toMatchObject({ loose_citations: 1, unfounded_citations: 0, fact_citation_share: 0.5, memory_citation_share: 0.5 });
  });

  it("a why that's a fragment is generic: under five words, or no verb", () => {
    expect(whyIsGeneric("The climax, the shared moment", NAMES)).toBe(true);
    expect(whyIsGeneric("Her pottery hands, steady and slow now", NAMES)).toBe(true);
    expect(whyIsGeneric("Building toward it", NAMES)).toBe(true);
    expect(whyIsGeneric("Lexi wants him to hear how close she is.", NAMES)).toBe(false);
    expect(whyIsGeneric("She remembers his pottery hands from the truck.", NAMES)).toBe(false);
    expect(whyIsGeneric("The pie joke makes her laugh every time.", NAMES)).toBe(false);
    expect(whyIsGeneric(null, NAMES)).toBe(false);
    const q = sceneQuality({ a: sideOfCharacter(dex()), b: sideOfCharacter(lexi()), lines: lines(["a", "Lexi.", { why: "The climax, the shared moment" }], ["b", "Dex.", { why: "She wants him to hear her say his name." }]) });
    expect(q.generic_whys).toBe(1);
  });

  it("the v2 prompt asks for a whole sentence even at the climax, and a memory the line uses; v1 doesn't", () => {
    const user = prompt(banter(4))[1].content;
    expect(user).toContain(`It's a whole sentence about this character's own reason, with a verb, even at the climax: never a fragment ("the climax, the shared moment").`);
    expect(user).toContain(`(like "F3" or "M1"), or null, and only one this line uses.`);
    expect(prompt(banter(4), { promptVersion: "v1" })[1].content).not.toContain("never a fragment");
  });
});

describe("(6) possessive set labels ('Lexis bedroom')", () => {
  it("a set keeps whose it is, as written; an unowned label never lands in someone's", () => {
    expect(drawLabel("Lexi's bedroom")).toBe("Lexi's bedroom");
    expect(drawLabel("Lexi’s cozy bedroom glow")).toBe("Lexi's bedroom");
    expect(drawLabel("Chud's place")).toBe("Chud's living room");
    expect(drawLabel("bedroom glow")).toBe("bedroom");
    expect(drawLabel("Dex's truck")).toBe("Dex's truck");
    expect(closestSet("Lexi's bedroom", ["cozy bedroom", "Lexi's bedroom"])).toBe("Lexi's bedroom");
    expect(closestSet("Lexi's bedroom", ["cozy bedroom"])).toBeNull();
    expect(closestSet("bedroom glow", ["Lexi's bedroom"])).toBeNull();
  });

  it("puts a lost apostrophe back on one of their names, and nowhere else", () => {
    const names = { a: "Dex Okafor", b: "Lexi" };
    expect(possessiveNames("Lexis bedroom", names)).toBe("Lexi's bedroom");
    expect(possessiveNames("dexs truck", names)).toBe("dex's truck");
    expect(possessiveNames("Lexi's bedroom", names)).toBe("Lexi's bedroom");
    expect(possessiveNames("Lexis", names)).toBe("Lexis");
    expect(possessiveNames("the bakery basics room", names)).toBe("the bakery basics room");
    expect(possessiveNames("Lexis bedroom", { a: "Lexis Moreau", b: "Lexi" })).toBe("Lexis bedroom");
  });

  it("'Lexi's bedroom' stays 'Lexi's bedroom' in the scene state after a move", async () => {
    const atTruck = sceneWith(banter(6), { place: "outside the truck, in the fog", set_place: "street", place_history: [{ place: "outside the truck, in the fog", set: "street", home: null, chapter: 1 }] });
    const out = reply(lines(["b", "Come back to my place? My bed's warmer than this truck."], ["a", "Lead the way."]), { place: "Lexi's bedroom", set: "Lexi's bedroom" });
    const r = await step(scripted(out).model, { scene: atTruck });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.set_place).toBe("Lexi's bedroom");
    expect(r.next.place_history.at(-1)).toMatchObject({ set: "Lexi's bedroom", home: "b" });
    expect(r.lines[1].moved_to).toBe("Lexi's bedroom");
    expect(r.next.moves.at(-1)).toMatchObject({ to: "Lexi's bedroom", taken: true });
  });

  it("a set typed without its apostrophe ('Lexis bedroom', set the scene on prod) is put right on the next step, in the prompt and the state", async () => {
    const cut = sceneWith(banter(6), {
      chapter: 3,
      place: "Lexis bedroom",
      set_place: "Lexis bedroom",
      stage: 4,
      place_history: [
        { place: "outside the truck, in the fog", set: "street", home: null, chapter: 1 },
        { place: "Lexis bedroom", set: "Lexis bedroom", home: null, chapter: 2 },
      ],
    });
    const { model, calls } = scripted(reply(lines(["a", "*pulls the quilt over them* Warm enough?"], ["b", "Getting there."]), { place: "on the bed", set: "bedroom" }));
    const r = await step(model, { scene: cut });
    expect(calls[0].messages[0].content).toContain("Where they are now: Lexi's bedroom.");
    expect(r.ok && r.next.set_place).toBe("Lexi's bedroom");
    expect(r.ok && r.next.place_history.at(-1)).toEqual({ place: "on the bed", set: "Lexi's bedroom", home: null, chapter: 2 });
  });

  it("the theater shows it with its apostrophe", () => {
    const chars: [CharacterRef, CharacterRef] = [
      { id: "house-dex", name: "Dex Okafor", house: true, hue: 15, portrait: null },
      { id: "lexi-1", name: "Lexi", house: false, hue: 300, portrait: null },
    ];
    const html = renderToStaticMarkup(
      createElement(AfterDarkTheater, { scene: { lines: lines(["a", "Hi."]), place: "on the bed", stage: 4, dateVenue: null, set: "Lexi's bedroom" }, characters: chars, onExit: () => {} }),
    );
    expect(html).toContain("Lexi&#x27;s bedroom");
    expect(html).not.toContain("Lexis bedroom");
  });
});

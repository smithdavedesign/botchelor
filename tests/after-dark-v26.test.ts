import { describe, expect, it } from "vitest";
import {
  ACTION_ONLY_MAX,
  actionOnlyRun,
  asideAllowance,
  asideMessages,
  asidesToRewrite,
  checkAsides,
  misattributedQuote,
  overusedTics,
  parseAsideReply,
  TIC_CAP,
  ticsIn,
  withoutQuote,
  withoutTics,
  withRewrite,
} from "@/lib/adult/asides";
import { steerQuotes } from "@/lib/adult/quotes";
import { dropRepeats, emptyScene, sceneMessages, writeSceneStep, type SceneLine, type StepInput } from "@/lib/adult/scenes";
import { SCENE_PROMPT_REVISION } from "@/lib/adult/settings";
import { assembleCharacter } from "@/lib/character";
import type { ChatMessage, Model } from "@/lib/model";
import { houseCharacter } from "./after-dark-prompt-cases";

// After Dark v2.6 (David's Chud × Juniper night, replayed on v2.5): 43% of her lines from undressing on still dry or
// technical asides, the sea back in words no sheet has, "'Kay." nine times, and a quote the steer gave Chud said by her.
// Every line here is a neutral stand-in, never a real scene's words, and the network is stubbed: the model is a script.

const chud = () =>
  assembleCharacter({
    id: "chud-1",
    sheet: {
      name: "Chud Mallow",
      age: 33,
      bio: "A sysadmin who keeps a logistics firm's servers alive and narrates his day like an incident report.",
      traits: ["chaotic", "loyal", "competitive"],
      want: "Someone who laughs at his outage stories",
      dealbreaker: "People who reply-all",
      house: false,
      pronouns: "he/him",
      voice: "Deadpan tech-support jokes, always one crisis away from a pun.",
    },
    soul: null,
    memory: null,
    extras: { occupation: "Systems administrator", hobbies: ["Debugging", "Server migrations"], quirk: "Recites emergency protocols when he's nervous" },
  });
const juniper = () => houseCharacter("house-juniper");
const PAIR = { a: { id: "chud-1", name: "Chud Mallow" }, b: { id: "house-juniper", name: "Juniper Vale" } };
const NAMES = { a: "Chud Mallow", b: "Juniper Vale" };

const CHUD = ["Your hands are cold.", "Say that again, slower.", "I like this side of you.", "Don't you dare stop now.", "You're shaking. Good.", "Look at me."];
const JUNIPER = ["Mm. Warmer now.", "Make me.", "Is that a promise?", "Don't talk. Kiss me.", "You're staring.", "Closer."];
const night = (): SceneLine[] => CHUD.flatMap((text, i) => [{ who: "a" as const, text }, { who: "b" as const, text: JUNIPER[i] }]);
const lines = (...xs: ["a" | "b", string][]): SceneLine[] => xs.map(([who, text]) => ({ who, text }));

const isAsideCall = (m: ChatMessage[]) => m[0].content.startsWith("You are an editor");

/** A script: the scene's replies in order (the last one repeats), and the aside check's own, kept apart. */
function scripted(scene: unknown[], aside: unknown | (() => Promise<string>) = { asides: [] }) {
  const calls: ChatMessage[][] = [];
  let n = 0;
  const model: Model = {
    complete: async (messages) => {
      calls.push(messages);
      if (isAsideCall(messages)) return typeof aside === "function" ? (aside as () => Promise<string>)() : typeof aside === "string" ? aside : JSON.stringify(aside);
      const r = scene[Math.min(n++, scene.length - 1)];
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  };
  return { model, calls };
}
const reply = (xs: { who: "a" | "b"; text: string; action?: string }[], extra: Record<string, unknown> = {}) => ({
  lines: xs.map((l) => ({ why: "They want each other.", memory: null, ...l })),
  stage: 5,
  ...extra,
});

function input(model: Model, over: Partial<StepInput> = {}): StepInput {
  return {
    model,
    a: chud(),
    b: juniper(),
    pair: PAIR,
    date: null,
    scene: { ...emptyScene(), lines: night(), stage: 4, stage_from: -40, place: "her bedroom" },
    steer: null,
    steerMode: "nudge",
    promptVersion: "v2",
    sampling: { temperature: 0.8, frequency_penalty: null, presence_penalty: null, repetition_penalty: null },
    memories: [],
    facts: [],
    styles: { a: [], b: [] },
    cast: new Set(["dex"]),
    ...over,
  };
}

describe("the aside check's reply and share", () => {
  it("reads the labels and rewrites, and nothing out of range; a reply it can't read is null", () => {
    const r = parseAsideReply('```json\n{"asides": ["H2", "N1", "N9", "x"], "rewrites": {"N1": "*smiles* Juniper: \\"Closer. Now.\\"", "H2": "no"}}\n```', 3, 2)!;
    expect([...r.history]).toEqual([1]);
    expect([...r.batch]).toEqual([0]);
    expect([...r.rewrites]).toEqual([[0, "Closer. Now."]]);
    expect(parseAsideReply("not json", 3, 2)).toBeNull();
    expect(parseAsideReply('{"lines": []}', 3, 2)).toBeNull();
  });

  it("about one line in six of a speaker's, history and batch together; the newest excess first, never a kept line", () => {
    expect(asideAllowance(3)).toBe(1);
    expect(asideAllowance(9)).toBe(1);
    expect(asideAllowance(12)).toBe(2);
    const history = lines(["b", "One."], ["a", "Two."], ["b", "Three."], ["a", "Four."], ["b", "Five."], ["b", "Six."]);
    const batch = lines(["a", "Seven."], ["b", "Eight."], ["a", "Nine."], ["b", "Ten."], ["b", "*only a look*"]);
    const marked = { history: new Set([0, 2]), batch: new Set([1, 3]), rewrites: new Map([[1, "plain eight"], [3, "plain ten"]]) };
    // Hers: 4 in the history + 2 new that say something = 6, allowance 1, asides 4: both new ones go.
    expect(asidesToRewrite(history, batch, marked)).toEqual([1, 3]);
    // A line that can't be rewritten (a quote, a move) counts but stays.
    expect(asidesToRewrite(history, batch, marked, (i) => i === 3)).toEqual([1]);
    // Within the share, nothing.
    expect(asidesToRewrite([], batch, { history: new Set(), batch: new Set([1]), rewrites: new Map([[1, "x"]]) })).toEqual([]);
    // A marked line with no rewrite stays as written.
    expect(asidesToRewrite(history, batch, { ...marked, rewrites: new Map([[3, "plain ten"]]) })).toEqual([3]);
  });

  it("the rewrite keeps the line's own action; the messages tag lines H and N with the steer's quotes", () => {
    expect(withRewrite("*pulls him closer* The tide's coming in.", "Closer.")).toBe("*pulls him closer* Closer.");
    expect(withRewrite("The tide's coming in.", "Closer.")).toBe("Closer.");
    const [system, user] = asideMessages(lines(["a", "Hi."]), lines(["b", "*leans in* Fog's rolling in."]), NAMES, [{ text: "come here", who: "a" }]);
    expect(system.content).toMatch(/^You are an editor/);
    expect(system.content).toContain("a tide, a storm front, a squall, fog");
    expect(user.content).toContain("H1 Chud: Hi.");
    expect(user.content).toContain("N1 Juniper: *leans in* Fog's rolling in.");
    expect(user.content).toContain('"come here"');
  });
});

describe("the aside check fails open", () => {
  const batch = lines(["b", "The storm front's moving through."]);
  it("an error, a timeout or an unreadable reply proposes nothing and says it failed", async () => {
    const boom: Model = { complete: async () => Promise.reject(new Error("503")) };
    expect(await checkAsides(boom, { history: [], batch, names: NAMES })).toMatchObject({ failed: true, proposed: new Map(), reason: "503" });
    const never: Model = { complete: () => new Promise<string>(() => {}) };
    expect(await checkAsides(never, { history: [], batch, names: NAMES }, { timeoutMs: 15 })).toMatchObject({ failed: true, reason: "timed out" });
    const junk: Model = { complete: async () => "sure!" };
    expect(await checkAsides(junk, { history: [], batch, names: NAMES })).toMatchObject({ failed: true, reason: "unreadable reply" });
  });

  it("action-only batches aren't sent at all", async () => {
    let called = 0;
    const m: Model = { complete: async () => (called++, "{}") };
    expect(await checkAsides(m, { history: [], batch: lines(["b", "*leans in*"]), names: NAMES })).toMatchObject({ failed: false, marked: 0 });
    expect(called).toBe(0);
  });
});

describe("through a step, from undressing on", () => {
  const sceneReply = reply([
    { who: "a", text: "Stay right there." },
    { who: "b", action: "pulls him closer", text: "The storm front is right on schedule." },
  ]);

  it("one extra call; the excess aside takes its plain rewrite (its action kept), counted in the flags", async () => {
    // Two of her recent lines were asides already (H2, H4), so a third is past her share of seven.
    const { model, calls } = scripted([sceneReply], { asides: ["H2", "H4", "N2"], rewrites: { N2: "Don't you dare move." } });
    const r = await writeSceneStep(input(model));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(calls).toHaveLength(2);
    expect(isAsideCall(calls[1])).toBe(true);
    expect(r.lines.map((l) => l.text)).toEqual(["Stay right there.", "*pulls him closer* Don't you dare move."]);
    expect(r.next.lines.at(-1)?.text).toBe("*pulls him closer* Don't you dare move.");
    expect(r.flags).toMatchObject({ prompt: SCENE_PROMPT_REVISION, asides_rewritten: 1, asides_marked: 3 });
    expect(r.flags.aside_check_failed).toBeUndefined();
    expect(SCENE_PROMPT_REVISION).toBe("v2.6");
  });

  it("fail-open: the check erroring or timing out leaves the lines as written", async () => {
    const { model } = scripted([sceneReply], () => Promise.reject(new Error("upstream")));
    const r = await writeSceneStep(input(model));
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(["Stay right there.", "*pulls him closer* The storm front is right on schedule."]);
    expect(r.ok && r.flags).toMatchObject({ aside_check_failed: true, asides_rewritten: 0 });
  });

  it("a rewrite is held to every guard: the two lines, a stranger, a repeat, going further, the steer copied", async () => {
    const tryWith = async (rewrite: string, over: Partial<StepInput> = {}, written: unknown = sceneReply) => {
      const { model } = scripted([written], { asides: ["H2", "H4", "N2"], rewrites: { N2: rewrite } });
      const r = await writeSceneStep(input(model, over));
      return r.ok ? { last: r.lines[1].text, n: r.flags.asides_rewritten } : null;
    };
    const asWritten = { last: "*pulls him closer* The storm front is right on schedule.", n: 0 };
    expect(await tryWith("She was a schoolgirl once.")).toEqual(asWritten);
    expect(await tryWith("Dex would never do this for me.")).toEqual(asWritten);
    expect(await tryWith("I like this side of you.")).toEqual(asWritten); // said tonight already
    // Further than the line went: at undressing, a rewrite can't bring in the last stage.
    const undressing = { scene: { ...emptyScene(), lines: night(), stage: 3, stage_from: -40, place: "her bedroom" } };
    expect(await tryWith("Let's climax right now.", undressing, { ...sceneReply, stage: 4 })).toEqual(asWritten);
    expect(await tryWith("Keep going, slowly.", undressing, { ...sceneReply, stage: 4 })).toEqual({ last: "*pulls him closer* Keep going, slowly.", n: 1 });
    expect(await tryWith("Sorry, I can't continue with this scene.")).toEqual(asWritten);
    expect(await tryWith("Kiss me like the lights went out tonight.", { steer: "kiss me like the lights went out tonight", steerMode: "nudge" })).toEqual(asWritten);
    expect(await tryWith("Keep going, slowly.")).toEqual({ last: "*pulls him closer* Keep going, slowly.", n: 1 });
  });

  it("a separate checker runs the check, so a slow writer never times it out (2026-10-26)", async () => {
    const { model, calls } = scripted([sceneReply]);
    const checked: ChatMessage[][] = [];
    const checker: Model = { complete: async (m) => (checked.push(m), JSON.stringify({ asides: ["H2", "H4", "N2"], rewrites: { N2: "Don't you dare move." } })) };
    const r = await writeSceneStep(input(model, { checker }));
    expect(calls.filter(isAsideCall)).toHaveLength(0);
    expect(checked).toHaveLength(1);
    expect(r.ok && r.lines[1].text).toBe("*pulls him closer* Don't you dare move.");
  });

  it("within her share, the aside stays as written", async () => {
    const { model } = scripted([sceneReply], { asides: ["N2"], rewrites: { N2: "Don't you dare move." } });
    const r = await writeSceneStep(input(model));
    expect(r.ok && r.lines[1].text).toBe("*pulls him closer* The storm front is right on schedule.");
    expect(r.ok && r.flags).toMatchObject({ asides_rewritten: 0, asides_marked: 1 });
  });

  it("never before undressing: no extra call", async () => {
    const { model, calls } = scripted([reply([{ who: "a", text: "Hello there." }, { who: "b", text: "The fog's thick tonight." }], { stage: 1 })]);
    const r = await writeSceneStep(input(model, { scene: { ...emptyScene(), lines: night(), stage: 0, stage_from: 0, place: "the pier" } }));
    expect(r.ok).toBe(true);
    expect(calls.filter(isAsideCall)).toHaveLength(0);
    expect(r.ok && r.flags.asides_rewritten).toBeUndefined();
  });
});

describe("the tic guard", () => {
  it("reads short interjections once a sentence", () => {
    expect(ticsIn("*nods* 'Kay. 'Kay.")).toEqual(["kay", "kay"]);
    expect(ticsIn("Okay, sure. That's a long sentence now.")).toEqual(["okay sure"]);
    expect(ticsIn("*only an action*")).toEqual([]);
  });

  it(`past ${TIC_CAP} a chapter, the interjection goes and the action stays; a line of nothing else goes`, () => {
    const seen = ["'Kay.", "*smiles* 'Kay."];
    expect(withoutTics("*looks up at him* 'Kay.", seen)).toEqual({ text: "*looks up at him*", cut: ["kay"] });
    expect(withoutTics("'Kay. Come here.", seen)).toEqual({ text: "Come here.", cut: ["kay"] });
    expect(withoutTics("'Kay.", seen)).toEqual({ text: null, cut: ["kay"] });
    expect(withoutTics("'Kay.", ["'Kay."])).toEqual({ text: "'Kay.", cut: [] });
    // Twice within one line counts too.
    expect(withoutTics("'Kay. 'Kay.", ["'Kay."]).text).toBe("'Kay.");
    // A word the owner's steer says is theirs to ask for.
    expect(withoutTics("'Kay.", seen, ["she says kay"]).cut).toEqual([]);
  });

  it("dropRepeats cuts it from undressing on, by speaker, and counts it", () => {
    const chapter = lines(["b", "'Kay."], ["a", "Good."], ["b", "*smiles* 'Kay."], ["a", "Again."]);
    const written = lines(["b", "*looks up at him* 'Kay."], ["a", "'Kay."]);
    const r = dropRepeats(written, chapter, chapter, chud(), juniper(), { craft: true, topics: { stage: 3 } });
    expect(r.kept.map((l) => l.text)).toEqual(["*looks up at him*", "'Kay."]);
    expect(r.cuts.tics).toBe(1);
    const early = dropRepeats(written, chapter, chapter, chud(), juniper(), { craft: true, topics: { stage: 2 } });
    expect(early.cuts.tics).toBe(0);
  });

  it("the prompt names the tic and a run of action-only lines, from undressing on", () => {
    const past = [...night(), ...lines(["b", "'Kay."], ["a", "Yes."], ["b", "*nods*"], ["a", "There."], ["b", "*smiles* 'Kay."], ["a", "Good."], ["b", "*leans in*"], ["b", "*waits*"])];
    expect(overusedTics(past, "b")).toEqual(["kay"]);
    expect(actionOnlyRun(past, "b")).toBeGreaterThanOrEqual(ACTION_ONLY_MAX);
    const system = (stage: number) => sceneMessages(chud(), juniper(), null, past, null, PAIR.a.id, { place: "her bedroom", stage, linesAtStage: 20, opening: false, promptVersion: "v2" } as never)[0].content;
    expect(system(3)).toContain(`- Juniper keeps saying the same short word ("kay"): not again; a line that says it loses it.`);
    expect(system(3)).toContain("of Juniper's last 6 lines were only an action: her next lines say something too, what she feels or wants, in her own words.");
    expect(system(2)).not.toContain("keeps saying the same short word");
  });
});

describe("the quotes' owners", () => {
  it("a quote that opens the steer, then a pronoun only one goes by, is theirs (v2.4 and v2.5 gave it to nobody)", () => {
    expect(steerQuotes('"Hold still" he pulls her close', NAMES, { a: "he/him", b: "she/her" })).toEqual([{ text: "Hold still", who: "a" }]);
    expect(steerQuotes('"Hold still", Juniper whispers', NAMES, { a: "he/him", b: "she/her" })).toEqual([{ text: "Hold still", who: "b" }]);
    expect(steerQuotes('"Hold still" and the lights go out', NAMES, { a: "he/him", b: "she/her" })).toEqual([{ text: "Hold still", who: null }]);
    expect(steerQuotes('Chud "come in, don\'t be shy"', NAMES)).toEqual([{ text: "come in, don't be shy", who: "a" }]);
  });

  it("finds a quote said by the wrong one and takes it out of that line", () => {
    const q = [{ text: "come in, don't be shy", who: "a" as const }];
    expect(misattributedQuote(q, { who: "b", text: "*waves* Come in, don't be shy." })).toEqual(q[0]);
    expect(misattributedQuote(q, { who: "a", text: "Come in, don't be shy." })).toBeNull();
    expect(withoutQuote("*waves* Come in, don't be shy. I'm right here.", q[0].text)).toEqual({ text: "*waves* I'm right here.", said: "Come in, don't be shy." });
    expect(withoutQuote("Come in, don't be shy.", q[0].text)).toEqual({ text: null, said: "Come in, don't be shy." });
  });

  it("through a step: moved to its speaker's nearest line, and the step counts the quote as said by him", async () => {
    const { model } = scripted([
      reply([
        { who: "a", action: "opens the door wide", text: "Well, look who's here." },
        { who: "b", text: "Come in, don't be shy. He won't bite." },
      ]),
    ]);
    const r = await writeSceneStep(input(model, { steer: 'Chud "come in, don\'t be shy"', steerMode: "direct" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => [l.who, l.text])).toEqual([
      ["a", "*opens the door wide* Come in, don't be shy. Well, look who's here."],
      ["b", "He won't bite."],
    ]);
    expect(r.flags).toMatchObject({ quotes_misattributed: 1, quotes_moved: 1, quote_kept: true });
  });

  it("with no line of his to take it, the wrong copy goes and the step asks again for his", async () => {
    const { model, calls } = scripted([
      reply([{ who: "b", text: "Come in, don't be shy." }]),
      reply([{ who: "a", text: "Come in, don't be shy." }, { who: "b", text: "Hi." }]),
    ]);
    const r = await writeSceneStep(input(model, { steer: 'Chud "come in, don\'t be shy"', steerMode: "direct" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(calls.filter((c) => !isAsideCall(c)).length).toBe(2);
    expect(r.lines[0]).toMatchObject({ who: "a", text: "Come in, don't be shy." });
    expect(r.flags.quote_kept).toBe(true);
  });
});

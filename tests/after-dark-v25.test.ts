import { describe, expect, it } from "vitest";
import { observeNight, ownerMoves, type ObservedChapter, type ObservedSide, type ObservedStep } from "@/lib/adult/observer";
import { CLINICAL_EVERY, clinicalWordsIn, driftOf, recentClinicalLines, topicsOf, voiceWithoutTopics } from "@/lib/adult/quality";
import { dropRepeats, emptyScene, sceneMessages, topicsAt, writeSceneStep, type SceneLine, type StepInput } from "@/lib/adult/scenes";
import { SCENE_PROMPT_REVISION } from "@/lib/adult/settings";
import { assembleCharacter, type Character } from "@/lib/character";
import type { ChatMessage, Model } from "@/lib/model";
import { scoreNight } from "../scripts/sim-after-dark.mjs";
import { houseCharacter } from "./after-dark-prompt-cases";

// After Dark v2.5 (David's Chud × Juniper night, replayed blind on v2.4): her deadpan "technical" quip nearly every line
// mid-sex, the sea back in the group half, and Chud teasing with her words. Every line here is a neutral stand-in, never
// a real scene's words.

/** A sysadmin (a fixture: servers, migrations, protocols), stored first ("chud-1" < "house-juniper"). */
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
const NAMES = ["Chud Mallow", "Juniper Vale"];

const CHUD = ["Your hands are cold.", "Say that again, slower.", "I like this side of you.", "Don't you dare stop now.", "You're shaking. Good.", "Look at me."];
const JUNIPER = ["Mm. Warmer now.", "Make me.", "Is that a promise?", "The rain's started again.", "Don't talk. Kiss me.", "You're staring."];
/** Twelve lines of talk with nothing from either sheet, and nothing clinical. */
const night = (): SceneLine[] => CHUD.flatMap((text, i) => [{ who: "a" as const, text }, { who: "b" as const, text: JUNIPER[i] }]);
const lines = (...xs: ["a" | "b", string][]): SceneLine[] => xs.map(([who, text]) => ({ who, text }));
const prompt = (stage: number, over: Record<string, unknown> = {}, steer: string | null = null) =>
  sceneMessages(chud(), juniper(), null, night(), steer, PAIR.a.id, { place: "her bedroom", stage, linesAtStage: 20, opening: false, promptVersion: "v2", ...over } as never).map((m) => m.content);

const JUNIPER_VOICE =
  "Dry and unhurried: short sentences, long pauses, a flat delivery on her strangest lines. Asks odd, sincere questions, drifts toward the sea, ghosts and the gulls, and never laughs at her own jokes.";

describe("the voice without its subjects, from undressing on", () => {
  it("Juniper's voice keeps its rhythm and delivery, and loses the sea, ghosts and the gulls (the subjects listed with them are cut too)", () => {
    expect(juniper().voice).toBe(JUNIPER_VOICE);
    expect(voiceWithoutTopics(JUNIPER_VOICE, topicsOf(juniper()))).toEqual({
      voice: "Dry and unhurried: short sentences, long pauses, a flat delivery on her strangest lines. Asks odd, sincere questions, and never laughs at her own jokes.",
      cut: ["sea"],
    });
  });

  it("is generic: the sheet's own topic words, whatever they are", () => {
    const topics = ["glass", "kiln"];
    // A clause naming one goes; the rest of the sentence stays, with a capital and no joining word left in front.
    expect(voiceWithoutTopics("Talks about glass and kilns, and asks one quiet question.", topics).voice).toBe("Asks one quiet question.");
    // What's before an "and" stays when it names nothing.
    expect(voiceWithoutTopics("Few words, asks odd questions and talks about glass.", topics).voice).toBe("Few words, asks odd questions.");
    // A list of peers with no clause opening it keeps the others ("easy compliments, … light flirting").
    expect(voiceWithoutTopics("Smooth: easy compliments, glass metaphors, light flirting in every line.", topics).voice).toBe("Smooth: easy compliments, light flirting in every line.");
    // A noun phrase before the preposition stays ("physical sentences about…").
    expect(voiceWithoutTopics("Restless: short, physical sentences about heights, kilns and fear.", topics)).toEqual({ voice: "Restless: short, physical sentences.", cut: ["height", "fear"] });
    // A sentence that's all subject goes whole; one with none is as it was.
    expect(voiceWithoutTopics("Loves glass. Quiet and slow.", topics).voice).toBe("Quiet and slow.");
    expect(voiceWithoutTopics("Quiet and slow, never hurried.", topics)).toEqual({ voice: "Quiet and slow, never hurried.", cut: [] });
    expect(voiceWithoutTopics("Quiet and slow.", [])).toEqual({ voice: "Quiet and slow.", cut: [] });
  });

  it("every house voice keeps a voice: none comes out empty or with a dangling comma", () => {
    for (const id of ["house-rafe", "house-juniper", "house-dex", "house-marisol", "house-teo", "house-kaz", "house-perpetua", "house-ines"]) {
      const c = houseCharacter(id);
      const { voice } = voiceWithoutTopics(c.voice ?? "", topicsOf(c));
      expect(voice.length, id).toBeGreaterThan(20);
      expect(voice, id).not.toMatch(/[,;:]\s*[.!?]|\s[,;:]|^[a-z]/);
    }
  });

  it("the prompt gives the full voice and samples before undressing, and from undressing on the voice without them", () => {
    const [early] = prompt(2);
    expect(early).toContain(`Voice: ${JUNIPER_VOICE}`);
    expect(early).toContain("You'd make a decent lighthouse");
    expect(early).toContain("The sea does worse");
    const [late] = prompt(3);
    expect(late).toContain("Voice: Dry and unhurried: short sentences, long pauses, a flat delivery on her strangest lines. Asks odd, sincere questions, and never laughs at her own jokes.");
    expect(late).not.toContain("drifts toward the sea");
    // The sample lines naming either sheet's topics (or the sea her voice listed with them) are out; the others stay.
    expect(late).not.toContain("You'd make a decent lighthouse");
    expect(late).not.toContain("The gulls said you'd be late");
    expect(late).not.toContain("The sea does worse");
    expect(late).toContain("That's a question for a foggier night.");
    // v1 is untouched.
    expect(prompt(3, { promptVersion: "v1" })[0]).toContain(`Voice: ${JUNIPER_VOICE}`);
  });

  it("from undressing on the voice rule is their rhythm and delivery, with nothing about their job coming up", () => {
    const [system, user] = prompt(3);
    expect(system).toContain("Stay this person when it gets intimate, in rhythm and delivery");
    expect(system).not.toContain("their job or a hobby comes up now and then");
    expect(user).not.toContain("their work or a hobby now and then");
    expect(prompt(2)[0]).toContain("their job or a hobby comes up now and then");
  });
});

describe("both sheets' topic words, from undressing on", () => {
  it("before undressing each is held to their own; from undressing on both are held to both, with the sea", () => {
    const early = topicsAt(chud(), juniper(), NAMES, 2);
    expect(early.a).toContain("server");
    expect(early.a).not.toContain("lighthous");
    expect(early.b).toContain("lighthous");
    expect(early.b).not.toContain("server");
    const late = topicsAt(chud(), juniper(), NAMES, 3);
    expect(late.a).toEqual(late.b);
    expect(late.a).toEqual(expect.arrayContaining(["server", "lighthous", "gull", "sea"]));
    // A steer or a whisper that names one makes it theirs to ask for, this step.
    expect(topicsAt(chud(), juniper(), NAMES, 3, ["they watch the sea from the window"]).a).not.toContain("sea");
  });

  const cut = (written: SceneLine[], stage: number, steered: string[] = []) =>
    dropRepeats(written, night(), night(), chud(), juniper(), { worn: true, craft: true, topics: { stage, steered } });

  it("Chud can't keep teasing with her words: past one line in 12 they're cut from his lines too", () => {
    const written = lines(["a", "My favourite lighthouse."], ["b", "Make me say it."], ["a", "*grins* Talk to the gulls later. Come here."]);
    const r = cut(written, 3);
    expect(r.kept.map((l) => l.text)).toEqual(["My favourite lighthouse.", "Make me say it.", "*grins* Come here."]);
    expect(r.cuts.topics).toBe(1);
    // Before undressing her words are hers: his aren't held to them.
    expect(cut(written, 2).kept).toEqual(written);
  });

  it("the prompt says so, and names his borrowed words in his note", () => {
    const [system] = prompt(3);
    expect(system).toContain("- Neither of them borrows the other's work or hobbies either: Chud doesn't tease with Juniper's, nor Juniper with Chud's.");
    const borrowed = sceneMessages(chud(), juniper(), null, [...night(), { who: "a", text: "Ghost stories, then." }, { who: "b", text: "Make me." }], null, PAIR.a.id, {
      place: "her bedroom",
      stage: 3,
      linesAtStage: 20,
      opening: false,
      promptVersion: "v2",
    } as never)[0].content;
    expect(borrowed).toContain(`- Chud talked about work or hobbies (his or Juniper's) in 1 of his last 7 lines, and that's one line in 12 at most from here. Don't lean on these words again: "ghost", "stories"`);
    expect(prompt(2)[0]).not.toContain("borrows the other's");
  });
});

describe("the wry asides rationed, and the clinical register held to its share, from undressing on", () => {
  it("the prompt rations the asides from undressing on, and not before", () => {
    const [system, user] = prompt(3);
    expect(system).toContain("- Dry asides are rationed: about one line in six may be commentary on what's happening");
    expect(system).toContain("The rest say what they feel, want or do, plainly");
    expect(user).toContain("About one line in six at most is a dry aside; the rest say what they feel, want or do, plainly.");
    const [early, earlyUser] = prompt(2);
    expect(early).not.toContain("Dry asides are rationed");
    expect(earlyUser).not.toContain("dry aside");
  });

  it("reads the register by the words' shape, not a character's vocabulary: their actions out, what any scene says plainly kept", () => {
    expect(clinicalWordsIn("Structural integrity holds. The acoustics are excellent.")).toEqual(["structural", "integrity", "acoustics"]);
    expect(clinicalWordsIn("The salinity is different. Containment failed.")).toEqual(["salinity", "containment"]);
    expect(clinicalWordsIn("*watches with clinical detachment* Come here.")).toEqual([]);
    expect(clinicalWordsIn("That sensation. The tension, the anticipation. Your position. Pay attention.")).toEqual([]);
    expect(clinicalWordsIn("I need you. Now.")).toEqual([]);
    // A word the steer or a whisper says is theirs to ask for.
    expect(clinicalWordsIn("The acoustics in here.", ["she jokes about the acoustics"])).toEqual([]);
  });

  const cut = (written: SceneLine[], stage: number, steered: string[] = []) =>
    dropRepeats(written, night(), night(), chud(), juniper(), { worn: true, craft: true, topics: { stage, steered } });

  it(`past one line in ${CLINICAL_EVERY}, a clinical line loses the sentences saying it, and goes when nothing's left`, () => {
    const written = lines(
      ["b", "Structural integrity holds."],
      ["a", "Then hold on."],
      ["b", "*pulls him down* The acoustics are excellent. Don't stop."],
      ["a", "Never."],
      ["b", "Calibration complete."],
    );
    const r = cut(written, 3);
    expect(r.kept.map((l) => l.text)).toEqual(["Structural integrity holds.", "Then hold on.", "*pulls him down* Don't stop.", "Never."]);
    expect(r.dropped).toEqual([{ who: "b", text: "Calibration complete.", reason: `the clinical register again ("calibration"; one of their lines in ${CLINICAL_EVERY} at most)` }]);
    expect(r.cuts.clinical).toBe(2);
    // Before undressing, and for a word the steer asks for, nothing is cut.
    expect(cut(written, 2).kept).toEqual(written);
    expect(cut(written, 3, ["the acoustics and the calibration"]).kept.map((l) => l.text)).toEqual([
      "Structural integrity holds.",
      "Then hold on.",
      "*pulls him down* The acoustics are excellent. Don't stop.",
      "Never.",
      "Calibration complete.",
    ]);
  });

  it("the prompt names a speaker past the register's share, from undressing on", () => {
    const past = [...night(), { who: "b" as const, text: "Containment is holding." }, { who: "a" as const, text: "Come here." }];
    const at = (stage: number) =>
      sceneMessages(chud(), juniper(), null, past, null, PAIR.a.id, { place: "her bedroom", stage, linesAtStage: 20, opening: false, promptVersion: "v2" } as never)[0].content;
    expect(recentClinicalLines(past, "b")).toHaveLength(1);
    expect(at(3)).toContain(`- Juniper said something clinical in 1 of her last 5 lines ("containment"): that's one line in ${CLINICAL_EVERY} at most. From here her lines say plainly what she feels, wants or does; a line in that register loses it.`);
    expect(at(2)).not.toContain("said something clinical");
  });

  it("through a step: the cut is counted in the flags, and the step says it's v2.5", async () => {
    expect(SCENE_PROMPT_REVISION).toBe("v2.5");
    const calls: ChatMessage[][] = [];
    const model: Model = {
      complete: async (m) => {
        calls.push(m);
        return JSON.stringify({
          lines: [
            { who: "a", text: "Then hold on.", why: "He wants her to know he's still here.", memory: null },
            { who: "b", text: "The acoustics are excellent. Don't stop.", why: "She wants him to keep going.", memory: null },
          ],
          stage: 4,
        });
      },
    };
    const scene = { ...emptyScene(), lines: [...night(), { who: "b" as const, text: "Structural integrity holds." }], stage: 3, stage_from: -40 };
    const input: StepInput = {
      model,
      a: chud(),
      b: juniper(),
      pair: PAIR,
      date: null,
      scene,
      steer: null,
      steerMode: "nudge",
      promptVersion: "v2",
      sampling: { temperature: 0.8, frequency_penalty: 0.3, presence_penalty: 0.3, repetition_penalty: null },
      memories: [],
      facts: [],
      styles: { a: [], b: [] },
      cast: new Set(),
    };
    const r = await writeSceneStep(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => l.text)).toEqual(["Then hold on.", "Don't stop."]);
    expect(r.flags).toMatchObject({ prompt: "v2.5", clinical_cut: 1 });
  });
});

describe("the sim's scoring", () => {
  const side = (c: Character): ObservedSide => ({ name: c.name, catchphrase: null, traits: [...c.persona.traits], tells: [], voice: c.voice ?? null, want: c.persona.want, bio: c.bio, details: ["Systems administrator", "Debugging"] });

  it("the sheet's share is read before undressing too, and the composite reads that one", () => {
    const at = (stage: number, who: "a" | "b", text: string) => ({ who, text, stage });
    const d = driftOf([at(0, "a", "The server room hums."), at(1, "a", "Pass the coffee."), at(3, "a", "Come here."), at(4, "a", "Don't stop.")], side(chud()), side(juniper()));
    expect(d.a.sheet_detail_rate).toBe(0.25);
    expect(d.a.sheet_detail_rate_early).toBe(0.5);
    expect(d.b.sheet_detail_rate_early).toBeNull();
    const report = (early: number | null) => ({ lines: 10, findings: [], summary: { drift: { a: { sheet_detail_rate: 0.2, sheet_detail_rate_early: early, cliche_rate: 0 } } } });
    expect(scoreNight(report(0.6), [], []).breakdown.voice_sheet_detail).toEqual({ value: 0.6, points: 15, of: 15 });
    // A report from before it existed reads the whole night's rate.
    expect(scoreNight(report(null), [], []).breakdown.voice_sheet_detail).toEqual({ value: 0.2, points: 0, of: 15 });
  });

  const chapter = (lines: { who: "a" | "b"; text: string; stage?: number }[], steps: ObservedStep[] = [], n = 1): ObservedChapter => ({
    chapter: n,
    source: "night",
    id: `n${n}`,
    lines,
    set_place: null,
    place: null,
    steps,
  });
  const observe = (chapters: ObservedChapter[], start = "the dinner") => observeNight({ a: side(chud()), b: side(juniper()), start, memories: [], chapters });
  const talk = (n: number) => Array.from({ length: n }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: i % 2 ? JUNIPER[(i >> 1) % 6] : CHUD[(i >> 1) % 6] }));

  it("a Set the scene (or a scenario's start) puts them there, and its write's arrival is agreed", () => {
    const set: ObservedStep[] = [
      { kind: "set_scene", direction: "the stalled elevator", line_from: null, flags: null },
      { kind: "write", line_from: 0, line_to: 3, steer_mode: "nudge", direction: null, flags: null },
      { kind: "write", line_from: 4, line_to: 7, steer_mode: null, direction: null, flags: null },
    ];
    const lines = [...talk(4), { who: "a" as const, text: "*turns her head toward the elevator panel* Still stuck." }, ...talk(3)];
    expect(observe([chapter(lines, set)]).summary.unprovoked_moves).toBe(0);
    // Without the step log it's read as before: from the dinner to the elevator, with nobody asking.
    expect(observe([chapter(lines)]).summary.unprovoked_moves).toBe(1);
  });

  it("a Direct steer that orders a move is agreed; a move in a nudge's lines with nobody asking still isn't", () => {
    const lines = [...talk(4), { who: "a" as const, text: "*carries her into the bedroom* There." }, ...talk(3)];
    const steps = (mode: "direct" | "nudge"): ObservedStep[] => [
      { kind: "write", line_from: 0, line_to: 3, steer_mode: null, direction: null, flags: null },
      { kind: "write", line_from: 4, line_to: 7, steer_mode: mode, direction: "He carries her to the bedroom", flags: null },
    ];
    expect(observe([chapter(lines, steps("direct"))], "her flat").summary.unprovoked_moves).toBe(0);
    expect(observe([chapter(lines, steps("nudge"))], "her flat").summary.unprovoked_moves).toBe(1);
    expect(ownerMoves(steps("direct"), lines.length).ordered).toEqual(new Set([4, 5, 6, 7]));
    expect(ownerMoves(steps("nudge"), lines.length).ordered).toEqual(new Set());
  });

  it("a chapter that carries the act on isn't a restart; one that goes back to kissing still is", () => {
    const ended = chapter([...talk(11), { who: "b", text: "Don't stop.", stage: 4 }]);
    const carriedOn = chapter([{ who: "a", text: "*she moans as he keeps going* Like that." }, ...talk(11)], [], 2);
    expect(observe([ended, carriedOn]).summary.chapter_restarts).toBe(0);
    const restarted = chapter([{ who: "a", text: "*kisses her slowly* Hi." }, ...talk(11)], [], 2);
    expect(observe([ended, restarted]).summary.chapter_restarts).toBe(1);
  });
});

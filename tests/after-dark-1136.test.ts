import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AfterDarkTheater, { unfollowedNote } from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import { narratedMove } from "@/lib/adult/continuity";
import { askedPlace, deriveTags, type TagSourceRow } from "@/lib/adult/media-tags";
import { othersAction, stepRepeatOf, steerFollowed, withoutStepRepeats } from "@/lib/adult/quality";
import { dropRepeats, emptyScene, writeSceneStep, type SceneLine, type StepInput } from "@/lib/adult/scenes";
import { stageReached } from "@/lib/adult/stage-floor";
import { assembleCharacter } from "@/lib/character";
import type { CharacterRef } from "@/lib/game";
import type { ChatMessage, Model } from "@/lib/model";
import { houseCharacter } from "./after-dark-prompt-cases";

// #1136, what was still open after #1144 and #1203 (the 2026-10-31 and 2026-11-01 visitor-ad loop runs): lines narrating
// a move the rules refused, "So far" ahead of the lines, no sign a steer was only partly followed, a sentence said twice in
// one step, an action under the wrong speaker, and a picture's place label from the scene instead of the picture. Every
// line here is a neutral stand-in, and the network is stubbed: the model is a script.

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
    extras: { occupation: "Systems administrator", hobbies: ["Debugging", "Server migrations"] },
  });
const juniper = () => houseCharacter("house-juniper");
const PAIR = { a: { id: "chud-1", name: "Chud Mallow" }, b: { id: "house-juniper", name: "Juniper Vale" } };

const night = (): SceneLine[] => [
  { who: "a", text: "This table wobbles." },
  { who: "b", text: "Everything here wobbles. That's the charm." },
  { who: "a", text: "Is that a rule you made up?" },
  { who: "b", text: "Just now, for you." },
];

/** The scene's replies in order (the last one repeats); every call it got, kept. */
function scripted(replies: unknown[]) {
  const calls: ChatMessage[][] = [];
  let n = 0;
  const model: Model = {
    complete: async (messages) => {
      calls.push(messages);
      const r = replies[Math.min(n++, replies.length - 1)];
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  };
  return { model, calls };
}
const reply = (xs: [("a" | "b"), string][], extra: Record<string, unknown> = {}) => ({
  lines: xs.map(([who, text]) => ({ who, text, why: "They want each other.", memory: null })),
  stage: 2,
  ...extra,
});

function input(model: Model, over: Partial<StepInput> = {}): StepInput {
  return {
    model,
    a: chud(),
    b: juniper(),
    pair: PAIR,
    date: null,
    scene: { ...emptyScene(), lines: night(), stage: 1, stage_from: 0, place: "the cafe", set_place: "cafe" },
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

// Off to her flat with nobody asking: the model says they're there, the rules refuse it (no agreement).
const STRAYS = reply(
  [
    ["a", "The cake is better than the coffee, at least."],
    ["b", "*unlocks the door to her flat and pushes it open* Mind the umbrella stand."],
    ["a", "*glances round the hallway* You have a lot of umbrellas."],
    ["b", "I lose them in sets of three."],
    ["a", "That's a strangely precise number."],
    ["b", "I'm a strangely precise person."],
  ],
  { place: "Juniper's flat", set: "her flat" },
);
const STAYS = reply(
  [
    ["a", "The cake is better than the coffee, at least."],
    ["b", "*pushes the plate toward him* Then finish mine too."],
    ["a", "Bribery. I respect it."],
    ["b", "It's not bribery if I enjoy watching you eat."],
    ["a", "*takes a slow bite* Is this better?"],
    ["b", "Much. Do it again."],
  ],
  { place: "the cafe" },
);

describe("#1136: lines narrating a move the rules refused", () => {
  it("narratedMove finds the line that walks them somewhere else, never where they already are", () => {
    const lines = [
      { who: "a" as const, text: "Hello." },
      { who: "b" as const, text: "*unlocks the door to her flat and pushes it open, revealing a dim, quiet hallway*" },
    ];
    expect(narratedMove(lines, "Juniper's place", "cafe")).toBe(1);
    expect(narratedMove(lines, "Juniper's place", "Juniper's place")).toBe(-1);
    expect(narratedMove([{ who: "b", text: "*smiles* Come on in." }], "the bar", "cafe")).toBe(-1);
    expect(narratedMove([{ who: "b", text: "*smiles* Welcome to my place." }], "Juniper's place", "cafe")).toBe(0);
    // Talking about going isn't going.
    expect(narratedMove([{ who: "a", text: "Your flat is near here, isn't it?" }], "Juniper's place", "cafe")).toBe(-1);
  });

  it("is asked for once more, at where they are, and the take that stays is used", async () => {
    const { model, calls } = scripted([STRAYS, STAYS]);
    const r = await writeSceneStep(input(model));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.flags.move_retry).toBe(true);
    expect(r.flags.calls).toBe(2);
    expect(r.flags.move_unagreed).toBeUndefined();
    const note = calls[1].at(-1)!.content;
    expect(note).toContain("Juniper's place");
    expect(note).toContain("still at cafe");
    expect(r.lines.map((l) => l.text)).toContain("Bribery. I respect it.");
    expect(r.next.set_place).toBe("cafe");
    expect(r.next.place).toBe("the cafe");
  });

  it("when the second take strays too, the first stands and the label stays where the rules settled it", async () => {
    const { model } = scripted([STRAYS]);
    const r = await writeSceneStep(input(model));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.flags.calls).toBe(2);
    expect(r.flags.move_unagreed).toBe("Juniper's place");
    expect(r.lines.some((l) => l.text.includes("unlocks the door"))).toBe(true);
    expect(r.next.set_place).toBe("cafe");
    expect(r.next.place).toBe("the cafe");
    expect(r.next.moves.at(-1)).toMatchObject({ taken: false, reason: "no_agreement" });
  });

  it("lines that stay put cost no second call", async () => {
    const { model } = scripted([STAYS]);
    const r = await writeSceneStep(input(model));
    expect(r.ok && r.flags.calls).toBe(1);
    expect(r.ok && r.flags.move_retry).toBeFalsy();
  });
});

describe("#1136: So far says how far the lines have gone", () => {
  const talk: SceneLine[] = [
    { who: "a", text: "Nice watch." },
    { who: "b", text: "It was my grandfather's. It runs four minutes slow." },
  ];
  it("not the stage a steer asked for before the lines got there", () => {
    expect(stageReached({ lines: talk, stage: 2 })).toBe(0);
    expect(stageReached({ lines: [...talk, { text: "*kisses her slowly*" }], stage: 2 })).toBe(2);
    // Never past the scene's own stage, and a new chapter's last chapter counts.
    expect(stageReached({ lines: [{ text: "*kisses her*" }], stage: 1 })).toBe(1);
    expect(stageReached({ lines: talk, prev_tail: [{ text: "*kisses her neck*" }], stage: 2 })).toBe(2);
  });
  it("with no lines yet, the scene's own stage (a new chapter carries on there)", () => {
    expect(stageReached({ lines: [], stage: 3 })).toBe(3);
  });
});

describe("#1136: a steer only partly followed", () => {
  const names = ["Odile Marsh", "Nell Byrne"];
  it("reads the steer's key words in the step's lines, past glue and their names", () => {
    const lines = [{ text: "*drums on the railing* The acoustics in here are wasted on us." }, { text: "Nell. Stop giving me the tour." }];
    expect(steerFollowed("stop deflecting with acoustics and tell Odile plainly the one thing she is actually afraid of tonight", lines, names)).toBe("partly");
    expect(steerFollowed("lead her back inside to the coat check", [{ text: "We should leave." }], names)).toBe("no");
    expect(steerFollowed("lead her back inside to the coat check", [{ text: "*leads her back inside, past the coat check*" }], names)).toBe("yes");
    expect(steerFollowed(null, lines, names)).toBeNull();
    expect(steerFollowed("Nell, now", lines, names)).toBeNull();
  });
  it("a Direct steer's quotes have to be said too", () => {
    expect(steerFollowed("dance", [{ text: "*they dance*" }], names, { all: 2, kept: 1 })).toBe("partly");
    expect(steerFollowed(null, [], names, { all: 1, kept: 1 })).toBeNull();
    expect(steerFollowed("", [], names, { all: 1, kept: 0 })).toBeNull();
  });
  it("the step logs it, with no extra call", async () => {
    const { model } = scripted([STAYS]);
    const r = await writeSceneStep(input(model, { steer: "tell him about the lighthouse keeper's cake", steerMode: "nudge" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.flags.steer_followed).toBe("partly");
    expect(r.flags.calls).toBe(1);
  });
  it("the theater says so under the lines, with Steer again", () => {
    expect(unfollowedNote({ text: "kiss  her", followed: "partly" })).toBe('Only partly followed: "kiss her".');
    expect(unfollowedNote({ text: "kiss her", followed: "no" })).toBe('Not followed: "kiss her".');
    const chars: [CharacterRef, CharacterRef] = [
      { id: "a", name: "Ada Vale", house: false, hue: 300, portrait: null },
      { id: "b", name: "Bo Reyes", house: false, hue: 200, portrait: null },
    ];
    const html = renderToStaticMarkup(
      createElement(AfterDarkTheater, {
        scene: { lines: [{ who: "a" as const, text: "Hi." }], place: null, stage: 0, dateVenue: null },
        characters: chars,
        onExit: () => {},
        onWrite: async () => true,
        steerAgain: { text: "tell her the truth", followed: "partly", onResend: () => {} },
      }),
    );
    expect(html).toContain("Only partly followed: &quot;tell her the truth&quot;.");
    expect(html).toContain("Steer again?");
  });
});

describe("#1136: a sentence said twice in one step", () => {
  it("stepRepeatOf finds one copied into another line, by either of them, or twice in one line", () => {
    const first = "*taps the table* A very steady beat. A metronome for a very short song.";
    expect(stepRepeatOf("You must have many small gears in there. A metronome for a very short song.", [first])).toBe("A metronome for a very short song.");
    expect(stepRepeatOf("A steady beat for a short song. A steady beat for a short song.", [])).toBe("A steady beat for a short song.");
    // Short sentences are said again all the time.
    expect(stepRepeatOf("I know. Come here.", ["I know. Come here."])).toBeNull();
    expect(stepRepeatOf("Something else entirely, said once.", [first])).toBeNull();
  });
  it("withoutStepRepeats keeps the action and what's new; null when nothing new is said", () => {
    expect(withoutStepRepeats("*grins* You must have many small gears in there. A metronome for a very short song.", ["A metronome for a very short song."])).toBe(
      "*grins* You must have many small gears in there.",
    );
    expect(withoutStepRepeats("*grins* A metronome for a very short song.", ["A metronome for a very short song."])).toBeNull();
  });
  it("dropRepeats cuts it from the step's lines (the near_duplicate critic only held a speaker to their own)", () => {
    const written: SceneLine[] = [
      { who: "a", text: "*taps the table* A very steady beat. A metronome for a very short song." },
      { who: "b", text: "You must have many small gears in there. A metronome for a very short song." },
      { who: "a", text: "Only the one, and it's slipping." },
    ];
    const r = dropRepeats(written, night(), night(), chud(), juniper());
    expect(r.kept.map((l) => l.text)).toEqual([written[0].text, "You must have many small gears in there.", written[2].text]);
    // Nothing new left of it: the line goes.
    const all = dropRepeats([written[0], { who: "b", text: "*leans in* Sure. A metronome for a very short song." }], night(), night(), chud(), juniper());
    expect(all.kept).toHaveLength(1);
  });
});

describe("#1136: a stage direction under the wrong speaker", () => {
  const barnaby = { name: "Barnaby Cole", pronouns: "he/him" };
  const tovah = { name: "Tovah Reyes", pronouns: "she/her" };
  it("the other one's pronoun or name opening the action, with nothing of the speaker's own in it", () => {
    expect(othersAction("*Her gaze drops to the vest covering his chest.*", barnaby, tovah)).toBe("her");
    expect(othersAction("*Tovah leans in* Well?", barnaby, tovah)).toBe("tovah");
    expect(othersAction("*Tovah's hand finds his* Hi.", barnaby, tovah)).toBe("tovah's");
    expect(othersAction("*His eyes darken.* Come here.", tovah, barnaby)).toBe("his");
  });
  it("keeps the speaker's own: their pronoun or name in it, an action without a subject, what's said", () => {
    expect(othersAction("*Her laugh makes him grin.*", barnaby, tovah)).toBeNull();
    expect(othersAction("*She laughs, and he pulls her close.*", barnaby, tovah)).toBeNull();
    expect(othersAction("*leans in* Her eyes are lovely.", barnaby, tovah)).toBeNull();
    expect(othersAction("Her gaze drops. I noticed.", barnaby, tovah)).toBeNull();
    expect(othersAction("*He grins*", barnaby, tovah)).toBeNull();
    // Two women: a pronoun can't tell them apart, only a name.
    const nell = { name: "Nell Byrne", pronouns: "she/her" };
    const odile = { name: "Odile Marsh", pronouns: "she/her" };
    expect(othersAction("*Her gaze drops*", odile, nell)).toBeNull();
    expect(othersAction("*Nell's breath catches*", odile, nell)).toBe("nell's");
  });
  it("the step drops it, counted", async () => {
    const { model } = scripted([
      reply([
        ["a", "The cake is better than the coffee, at least."],
        ["b", "*pushes the plate toward him* Then finish mine too."],
        ["a", "*Her gaze drops to the vest covering his chest.* Bribery."],
        ["b", "It's not bribery if I enjoy watching you eat."],
        ["a", "*takes a slow bite* Is this better?"],
        ["b", "Much. Do it again."],
      ], { place: "the cafe" }),
    ]);
    const r = await writeSceneStep(input(model));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.flags.wrong_speaker).toBe(1);
    expect(r.dropped.some((d) => /under the wrong speaker/.test(d.reason))).toBe(true);
    expect(r.lines.some((l) => l.text.includes("Her gaze drops"))).toBe(false);
  });
});

describe("#1136: a picture's place label from the place it was drawn", () => {
  const row = (over: Partial<TagSourceRow>): TagSourceRow => ({
    id: "x", kind: "scene", mime: "image/png", character_b: "b", scene_place: null, prompt: "", preset: null, shoot_kind: null, choices: null,
    beat_act: "standing", beat_place: null, beat_stage: 1, clip: null, shot: null, ...over,
  });
  const alley = "Make one photograph of the woman from Picture 1 and the woman from Picture 2 together. They stand close. The place: a narrow alley, an EXIT sign over a steel door. Keep each of them as in their own picture.";
  const places = (r: TagSourceRow) => deriveTags(r).filter((t) => t.kind === "place").map((t) => t.value);
  it("reads the prompt's place", () => {
    expect(askedPlace(alley)).toBe("a narrow alley, an EXIT sign over a steel door");
    expect(askedPlace("no place here")).toBeNull();
  });
  it("labels it from the prompt when that names somewhere else than where the scene was settled", () => {
    expect(places(row({ beat_place: "Nell's flat", scene_place: "Nell's flat", prompt: alley }))).toEqual(["street"]);
  });
  it("keeps the scene's place when the prompt agrees, or names none", () => {
    const home = alley.replace("a narrow alley, an EXIT sign over a steel door", "her flat's hallway, coats on hooks");
    expect(places(row({ beat_place: "Nell's flat", scene_place: "Nell's flat", prompt: home }))).toEqual(["home"]);
    expect(places(row({ beat_place: "Nell's flat", scene_place: "Nell's flat", prompt: "They stand close." }))).toEqual(["home"]);
  });
});

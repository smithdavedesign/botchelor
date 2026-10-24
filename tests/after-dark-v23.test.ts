import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { autoPictureKey, autoPicturesSettled, RETRY_AFTER_MS, setAutoPictureClockForTests } from "@/lib/adult/auto-pictures";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { runAdultTool } from "@/lib/adult/mcp";
import { observeNight } from "@/lib/adult/observer";
import { setMediaFetchForTests, VENICE_IMAGE } from "@/lib/adult/media";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { quoteOverlap, quotesKept, saysQuote, steerQuotes, withoutQuotes } from "@/lib/adult/quotes";
import { INTENSITIES, INTENSITY, intensityOf, NO_LIMITS, overIntensity, plainTalk, type Intensity } from "@/lib/adult/limits";
import { CHAPTER_LINES, chapterCarry, emptyScene, limitRefusal, sceneMessages, writeSceneStep, type SceneLine, type SceneState, type StepInput } from "@/lib/adult/scenes";
import { SCENE_PROMPT_REVISION } from "@/lib/adult/settings";
import { stageShown } from "@/lib/adult/stage-floor";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage, Model } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { houseCharacter } from "./after-dark-prompt-cases";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// After Dark v2.3 (David, 2026-10-23): a Direct steer's quoted lines are said nearly as written; a heat per scene
// (suggestive, frank, filthy); a new chapter picks up where the last one stopped; and a picture for each chapter and
// place. Every fixture here is a neutral stand-in, never a real scene's words.

// Stored lower id first: house-juniper (Juniper Vale, she/her) is "a", house-rafe (Rafe Calloway, he/him) is "b".
const NAMES = { a: "Juniper Vale", b: "Rafe Calloway" };
const PRONOUNS = { a: "she/her", b: "he/him" };

describe("a Direct steer's quoted lines", () => {
  it("finds each quote and who says it: the name before it, a slip of one, one after it, a pronoun only one goes by, or nobody", () => {
    expect(steerQuotes('Rafe leans on the counter and says "Juniper, stay for one more cup"', NAMES, PRONOUNS)).toEqual([{ text: "Juniper, stay for one more cup", who: "b" }]);
    // A typo of a name still names them; curly quotes count; two quotes, two speakers.
    expect(steerQuotes("Junpier laughs “you always say that” and Rafe answers “because it's true”", NAMES, PRONOUNS)).toEqual([
      { text: "you always say that", who: "a" },
      { text: "because it's true", who: "b" },
    ]);
    expect(steerQuotes('"Not tonight, not yet," says Rafe, smiling', NAMES, PRONOUNS)).toEqual([{ text: "Not tonight, not yet,", who: "b" }]);
    expect(steerQuotes('She puts the kettle on and says "tea first"', NAMES, PRONOUNS)).toEqual([{ text: "tea first", who: "a" }]);
    // The closest subject says it: an object pronoun ("her") names nobody.
    expect(steerQuotes('Rafe hugs her, then she says "tea first"', NAMES, PRONOUNS)).toEqual([{ text: "tea first", who: "a" }]);
    expect(steerQuotes('Rafe hugs her and says "tea first"', NAMES, PRONOUNS)).toEqual([{ text: "tea first", who: "b" }]);
    expect(steerQuotes('Someone whispers "the lights are still on"', NAMES, PRONOUNS)).toEqual([{ text: "the lights are still on", who: null }]);
    expect(steerQuotes("They go back to hers", NAMES, PRONOUNS)).toEqual([]);
    expect(steerQuotes(null, NAMES)).toEqual([]);
  });

  it("leaves the rest of the steer to act out, and reads a quote as said when most of its words are, out loud", () => {
    expect(withoutQuotes('Rafe sits down and says "stay for one more cup"')).toBe("Rafe sits down and says");
    expect(quoteOverlap("stay for one more cup", "Stay for one more cup, Juniper.")).toBe(1);
    // A name, a word or a tense can change.
    expect(saysQuote("Juniper, I needed you here", "June, I need you here.")).toBe(true);
    expect(saysQuote("stay for one more cup", "*pours one more cup* Stay.")).toBe(false);
    expect(saysQuote("stay for one more cup", "Let's go home.")).toBe(false);
    const quotes = steerQuotes('Rafe says "stay for one more cup"', NAMES, PRONOUNS);
    expect(quotesKept(quotes, [{ who: "a", text: "Stay for one more cup." }])[0]).toMatchObject({ kept: false });
    expect(quotesKept(quotes, [{ who: "a", text: "Hi." }, { who: "b", text: "Stay for one more cup, love." }])[0]).toMatchObject({ kept: true, by: "b", line: 1 });
  });
});

/** A scripted model that keeps every call's messages; each call takes the next reply (the last repeats). */
function scriptedModel(...replies: unknown[]) {
  const calls: ChatMessage[][] = [];
  const model: Model = {
    complete: async (messages) => {
      calls.push(messages);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  };
  return { model, calls };
}
const juniper = () => houseCharacter("house-juniper");
const rafe = () => houseCharacter("house-rafe");
const step = (model: Model, over: Partial<StepInput> = {}) =>
  writeSceneStep({
    model,
    a: juniper(),
    b: rafe(),
    pair: { a: { id: "house-juniper", name: NAMES.a }, b: { id: "house-rafe", name: NAMES.b } },
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
const reply = (xs: [("a" | "b"), string][], extra: Record<string, unknown> = {}) => ({ lines: xs.map(([who, text]) => ({ who, text, why: "He wants her to stay a little longer.", memory: null })), ...extra });

describe("quoted lines in a step", () => {
  const STEER = 'Rafe pours the last of the tea and says "stay for one more cup, Juniper"';

  it("tells the writer to say them nearly as written, keeps the line that does, and flags it", async () => {
    const { model, calls } = scriptedModel(reply([["a", "*glances at the clock* It's late."], ["b", "*pours the last of the tea* Stay for one more cup, Juniper."]]));
    const r = await step(model, { steer: STEER, steerMode: "direct" });
    expect(r.ok).toBe(true);
    const user = calls[0][1].content;
    expect(user).toContain('The words in quotes are lines to be spoken: Rafe says "stay for one more cup, Juniper". Each one is said out loud nearly as written');
    expect(user).toContain("Everything else in the steer is acted out in their own words and actions");
    if (!r.ok) return;
    // The steer-copy rule would have cut this line (most of the steer, word for word); with the quote out of it, it stays.
    expect(r.lines.map((l) => l.who)).toEqual(["a", "b"]);
    expect(r.flags).toMatchObject({ quote_kept: true, prompt: SCENE_PROMPT_REVISION });
    expect(r.flags.quotes).toEqual([{ text: "stay for one more cup, Juniper", who: "b", kept: true, by: "b", line: 1 }]);
    expect(calls).toHaveLength(1);
  });

  it("asks once more when no line said it, and keeps the take that does", async () => {
    const { model, calls } = scriptedModel(
      reply([["a", "It's late."], ["b", "*fills her cup* You'll want this."]]),
      reply([["a", "It's late."], ["b", "Stay for one more cup, Juniper."]]),
    );
    const r = await step(model, { steer: STEER, steerMode: "direct" });
    expect(calls).toHaveLength(2);
    expect(calls[1].at(-1)!.content).toMatch(/Your lines left out the steer's quoted words: Rafe says "stay for one more cup, Juniper"/);
    expect(r.ok && r.flags).toMatchObject({ quote_kept: true, quote_retry: true, retried: true, calls: 2 });
  });

  it("never fails the step over it: the first take stands, flagged", async () => {
    const { model, calls } = scriptedModel(reply([["a", "It's late."], ["b", "*fills her cup* You'll want this."]]), reply([["a", "Hm."]]));
    const r = await step(model, { steer: STEER, steerMode: "direct" });
    expect(calls).toHaveLength(2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => l.text)).toEqual(["It's late.", "*fills her cup* You'll want this."]);
    expect(r.flags).toMatchObject({ quote_kept: false, quote_retry: true });
  });

  it("isn't dropped as a repeat because it was said before tonight, and the rest of the steer still can't be copied", async () => {
    const night: SceneLine[] = [
      { who: "a", text: "Is there more tea?" },
      { who: "b", text: "Stay for one more cup, Juniper." },
    ];
    const { model } = scriptedModel(reply([["a", "*smiles* Fine."], ["b", "Stay for one more cup, Juniper."]]));
    const r = await step(model, { scene: { ...emptyScene(), lines: night }, steer: STEER, steerMode: "direct" });
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(["*smiles* Fine.", "Stay for one more cup, Juniper."]);
    // A line that copies the rest of the steer (its action, word for word) loses that action.
    const copy = scriptedModel(reply([["a", "Hm?"], ["b", "*pours the last of the tea* Stay for one more cup, Juniper."]]));
    const again = await step(copy.model, { steer: 'Rafe pours the last of the tea "stay for one more cup"', steerMode: "direct" });
    expect(again.ok && again.lines[1].text).toBe("Stay for one more cup, Juniper.");
  });

  it("a nudge, and prompt v1, keep the steer as before", async () => {
    const { model, calls } = scriptedModel(reply([["a", "Hm?"], ["b", "Later."]]));
    await step(model, { steer: STEER, steerMode: "nudge" });
    expect(calls[0][1].content).not.toContain("The words in quotes");
    const v1 = scriptedModel(reply([["a", "Hm?"], ["b", "Later."]]));
    const r = await step(v1.model, { steer: STEER, steerMode: "direct", promptVersion: "v1" });
    expect(v1.calls[0][1].content).toContain(`Steer the scene this way: ${STEER}`);
    expect(r.ok && r.flags).toMatchObject({ prompt: "v1" });
    expect(r.ok && r.flags.quotes).toBeUndefined();
  });
});

describe("the Filthy intensity, one above Explicit", () => {
  const prompt = (intensity: Intensity, stage: number, version: "v1" | "v2" = "v2", chips: string[] = []) => {
    const [system, user] = sceneMessages(juniper(), rafe(), null, [], null, "house-juniper", {
      place: "her flat", stage, linesAtStage: 20, opening: false, promptVersion: version, limits: { intensity, hard_nos: { chips, own: [] } },
    } as never);
    return { system: system.content, user: user.content };
  };

  it("is on the dial after Explicit, stored like the others, with Explicit's checks", () => {
    expect(INTENSITIES.at(-1)).toBe("filthy");
    expect(INTENSITY.filthy).toMatchObject({ label: "Filthy", maxStage: 4, register: null });
    expect(intensityOf("filthy")).toBe("filthy");
    // A swear on a mundane line stands in for crude talk: allowed at Explicit and Filthy, out below.
    expect(overIntensity("This fucking kettle.", "filthy")).toBeNull();
    expect(overIntensity("This fucking kettle.", "spicy")).toMatch(/too crude/);
    // Explicit's prompt is untouched by it.
    const explicit = prompt("explicit", 4);
    expect(explicit.system).toContain("Explicit sexual content is allowed and expected when the scene goes there; write it frankly, in each character's own voice.");
    // v2.5: from undressing on, Explicit's voice rule is their rhythm and delivery; before it, as it was.
    expect(explicit.system).toContain("Stay this person when it gets intimate, in rhythm and delivery");
    expect(prompt("explicit", 2).system).toContain("Stay this person when it gets intimate: their humour and the way they talk still show");
    expect(prompt("explicit", 2).user).toContain("their humour and their way of talking keep showing");
    expect(explicit.system).not.toContain("filthy");
  });

  it("from undressing on: plain dirty talk, the jokes and the job a light seasoning", () => {
    const late = prompt("filthy", 3);
    expect(late.system).toContain("this scene is written filthy");
    expect(late.system).toContain("Stay this person when it gets intimate, in attitude and rhythm");
    expect(late.system).toContain("no puns, no wordplay on their work");
    expect(late.system).toContain("- Filthy: they say what they want");
    expect(late.user).toContain("From here on they talk dirty in the dialogue itself, in plain, explicit words");
    expect(late.user).not.toContain("their humour and their way of talking keep showing");
    // Before undressing, the voice rules are frank's.
    const early = prompt("filthy", 1);
    expect(early.system).toContain("Stay this person when it gets intimate: their humour and the way they talk still show");
    expect(early.user).toContain("their humour and their way of talking keep showing");
    expect(early.system).not.toContain("- Filthy:");
  });

  it("a 'dirty talk' hard no wins: Explicit's prompt, and the hard-no check still drops a crude line", async () => {
    const held = prompt("filthy", 4, "v2", ["dirty_talk"]);
    expect(held.system).not.toContain("written filthy");
    expect(held.system).not.toContain("- Filthy:");
    expect(held.user).not.toContain("they talk dirty");
    expect(held.system).toContain("No dirty talk");
    expect(plainTalk({ intensity: "filthy", hard_nos: { chips: ["dirty_talk"], own: [] } }, 4)).toBe(false);
    expect(plainTalk({ ...NO_LIMITS, intensity: "filthy" }, 4)).toBe(true);
    expect(plainTalk({ ...NO_LIMITS, intensity: "filthy" }, 2)).toBe(false);
    const limits = { intensity: "filthy" as const, hard_nos: { chips: ["dirty_talk"], own: [] } };
    const { model } = scriptedModel(reply([["a", "*glares at the stove* This fucking kettle."], ["b", "*laughs into her hair* Still here."]], { stage: 5 }), reply([["a", "*pulls him close* Stay."], ["b", "Always."]], { stage: 5 }));
    const r = await step(model, { scene: { ...emptyScene(), stage: 4, stage_from: -20 }, limits });
    expect(r.ok && r.lines.map((l) => l.text)).not.toContain("*glares at the stove* This fucking kettle.");
    expect(r.ok && r.flags.hard_nos).toBeGreaterThan(0);
    expect(r.ok && r.flags.filthy).toBeUndefined();
  });

  it("prompt v1 is word for word at Filthy and Explicit", () => {
    expect(prompt("filthy", 4, "v1")).toEqual(prompt("explicit", 4, "v1"));
  });

  it("a step at Filthy is flagged so", async () => {
    const { model } = scriptedModel(reply([["a", "Hm."], ["b", "Mm."]]));
    const r = await step(model, { limits: { ...NO_LIMITS, intensity: "filthy" } });
    expect(r.ok && r.flags).toMatchObject({ filthy: true, prompt: SCENE_PROMPT_REVISION });
  });

  it("the stage floor reads plainer talk in the dialogue, not only the actions", () => {
    expect(stageShown("I want you inside me now.")).toBe(4);
    expect(stageShown("Ride with me back to town.")).toBeNull();
    expect(stageShown("Come in, the kettle's on.")).toBeNull();
  });
});

describe("a new chapter picks up where the last one stopped", () => {
  /** Chapter 2, the last chapter's tail at the last stage, in her flat. */
  const tail: SceneLine[] = [
    { who: "a", text: "*holds him close* Don't you dare stop.", stage: 4 },
    { who: "b", text: "*keeps the slow rhythm going* Not a chance.", stage: 4 },
    { who: "a", text: "*laughs into his shoulder* Good.", stage: 4 },
  ];
  const chapter2 = (over: Partial<SceneState> = {}): SceneState => ({ ...emptyScene(), chapter: 2, prev_tail: tail, stage: 4, stage_from: -40, place: "Juniper's flat", set_place: "Juniper's flat", ...over });

  it("gives the first lines the tail, the stage and the place, and says continue from here", async () => {
    const { model, calls } = scriptedModel(reply([["b", "*doesn't slow down* Still with me?"], ["a", "Always."]], { stage: 5 }));
    const r = await step(model, { scene: chapter2() });
    const system = calls[0][0].content;
    expect(system).toContain("A new chapter of the night starts here, but nothing has stopped: the last chapter ended mid-moment, at Juniper's flat, at sex (stage 5 of 5). Its last lines:");
    expect(system).toContain("Rafe Calloway: *keeps the slow rhythm going* Not a chance.");
    expect(system).toContain("Continue from here: the first of these lines carries straight on from that exact moment, in that place, at sex");
    expect(system).toContain("No teasing it out again, no going back to an earlier stage");
    expect(r.ok && r.flags.carry).toEqual({ stage: 4, place: "Juniper's flat", first: true, floor: true });
  });

  it("corrects a reply that drops below that stage, like any stage-floor breach", async () => {
    const { model } = scriptedModel(reply([["b", "*hands her a towel* Here."], ["a", "Thanks."]], { stage: 1 }));
    const r = await step(model, { scene: chapter2() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.stage).toBe(4);
    expect(r.lines.map((l) => l.stage)).toEqual([4, 4]);
    expect(r.flags.stage_floor_raised).toBe(true);
    // Later in the chapter it still holds, and the prompt says so (without the tail again).
    const later = scriptedModel(reply([["b", "Tea?"], ["a", "Later."]], { stage: 2 }));
    const r2 = await step(later.model, { scene: chapter2({ lines: [{ who: "a", text: "Mm.", stage: 4 }, { who: "b", text: "Mm.", stage: 4 }] }) });
    expect(later.calls[0][0].content).toContain("This chapter carries on from the last one, at sex (stage 5 of 5): it doesn't go back to an earlier stage.");
    expect(later.calls[0][0].content).not.toContain("Its last lines:");
    expect(r2.ok && r2.next.stage).toBe(4);
  });

  it("after an afterglow, the old rule: it picks up only when one of them starts it, and the stage may settle", async () => {
    const glow: SceneLine[] = [...tail.slice(0, 2), { who: "a", text: "*after the climax, she lies still against him* Wow.", stage: 4 }, { who: "b", text: "*strokes her hair* Tea?", stage: 4 }];
    const { model, calls } = scriptedModel(reply([["a", "Yes please."], ["b", "*goes to the kettle* Coming up."]], { stage: 1 }));
    const r = await step(model, { scene: chapter2({ prev_tail: glow }) });
    const system = calls[0][0].content;
    expect(system).toContain("The last one ended in an afterglow, at Juniper's flat, after sex; its last lines:");
    expect(system).toContain("it only picks up again when one of them starts it in a line and the other answers.");
    expect(r.ok && r.flags.carry).toMatchObject({ floor: false });
    expect(r.ok && r.flags.stage_floor_raised).toBeUndefined();
    expect(chapterCarry(chapter2({ chapter: 1 }), "x")).toBeNull();
  });
});

describe("the observer sees both", () => {
  const side = (name: string) => ({ name, catchphrase: null, traits: [], tells: [], voice: null, want: null });
  it("counts the quoted lines asked for and the ones dropped, and calls out a chapter that started over", () => {
    const report = observeNight({
      a: side(NAMES.a),
      b: side(NAMES.b),
      memories: [],
      chapters: [
        { chapter: 1, source: "night", id: "n1", set_place: null, place: null, lines: [{ who: "a", text: "*unbuttons his shirt* Finally.", stage: 3 }] },
        {
          chapter: 2,
          source: "scene",
          id: "s1",
          set_place: null,
          place: null,
          lines: [{ who: "b", text: "Lovely weather.", stage: 3 }, { who: "a", text: "Isn't it.", stage: 3 }],
          steps: [{ line_from: 0, flags: { quotes: [{ text: "stay for one more cup", who: "b", kept: false }, { text: "fine", who: "a", kept: true }], quote_kept: false } }],
        },
      ],
    });
    expect(report.summary).toMatchObject({ quotes_asked: 2, quotes_dropped: 1, chapter_restarts: 1 });
    expect(report.findings.map((f) => f.check)).toEqual(expect.arrayContaining(["quote_dropped", "chapter_restart"]));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The scene route, MCP and the automatic pictures, on the test database
// ---------------------------------------------------------------------------------------------------------------------

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setSetsFetchForTests(async () => new Response("no", { status: 500 }));
});
afterEach(async () => {
  await autoPicturesSettled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setSetsFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
});

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const get = async (cookie: string) => (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json();
const settings = (body: unknown, cookie: string) =>
  settingsPost(new Request(`${BASE_URL}/api/admin/after-dark/settings`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}

// Made-up words, never the same twice, so no guard reads two lines as a repeat.
let k = 0;
const word = () => `${["ka", "lo", "mi", "nu", "pe", "ra", "si", "tu", "vo", "ze"][k % 10]}${["ban", "dor", "fel", "gim", "hux", "jor", "kel", "lum", "mox", "nib"][Math.floor(k / 10) % 10]}${["a", "e", "i", "o", "u"][Math.floor(k++ / 100) % 5]}`;
const fresh = () => `${word()} ${word()} ${word()} ${word()}.`;
const six = (extra: Record<string, unknown> = {}) => ({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: fresh() })), ...extra });
/** The scene model: a step's reply (a function is called each time); the recap, facts and PG notes their own. */
function scripted(next: () => unknown) {
  const prompts: ChatMessage[][] = [];
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap/.test(messages[0].content)) return JSON.stringify({ recap: "They talked by the lighthouse until late." });
      if (/factual memory/.test(messages[0].content)) return JSON.stringify({ a: [], b: [] });
      if (/what a private night left behind/.test(messages[0].content)) return JSON.stringify({ a: "You talked until late.", b: "You talked until late." });
      prompts.push(messages);
      return JSON.stringify(next());
    },
  } as never);
  return prompts;
}

describe("Filthy, set from the Limits panel's route, and quoted lines held to the limits", () => {
  it("is saved with the limits like any intensity, and the next prompt writes it", async () => {
    const { cookie } = await admin();
    const prompts = scripted(() => six());
    const saved = await (await post({ a: CAST_A, b: CAST_B, limits: { intensity: "filthy" } }, cookie)).json();
    expect(saved.scene.intensity).toBe("filthy");
    expect((await t.db.query<{ intensity: string | null }>("select intensity from adult_scenes")).rows[0].intensity).toBe("filthy");
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(prompts[0][0].content).toContain("this scene is written filthy");
    const step = (await t.db.query<{ flags: { filthy?: boolean; prompt?: string } }>("select flags from adult_steps where kind = 'write' order by created_at desc limit 1")).rows[0];
    expect(step.flags).toMatchObject({ filthy: true, prompt: SCENE_PROMPT_REVISION });
    // after_dark_scene shows it with the scene.
    const read = await runAdultTool(t.db, "after_dark_scene", { a: CAST_A, b: CAST_B });
    expect("data" in read && (read.data.scene as { intensity: string }).intensity).toBe("filthy");
  });

  it("refuses a Direct steer whose quoted line crosses the intensity or a hard no, as any steer is", async () => {
    const scene = { stage: 2, intensity: "slow_burn" as const, hard_nos: { chips: ["biting"], own: [] } };
    expect(limitRefusal("steer", 'Rafe says "stay for one more cup"', scene)).toBeNull();
    expect(limitRefusal("steer", 'Rafe says "I want to unbutton your shirt"', scene)).toMatch(/past kissing/);
    expect(limitRefusal("steer", 'Rafe says "let me bite your shoulder"', scene)).toMatch(/hard limits/);
    expect(limitRefusal("steer", 'Rafe says "this fucking kettle"', { ...scene, intensity: "spicy" })).toMatch(/too crude for spicy/);
    expect(limitRefusal("steer", 'Rafe says "this fucking kettle"', { ...scene, intensity: "filthy" })).toBeNull();
    const { cookie } = await admin();
    await post({ a: CAST_A, b: CAST_B, limits: { intensity: "slow_burn" } }, cookie);
    const r = await post({ a: CAST_A, b: CAST_B, direction: 'Rafe says "I want to unbutton your shirt"', steer_mode: "direct" }, cookie);
    expect(r.status).toBe(422);
  });
});

describe("a picture for each chapter and each place", () => {
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.5 }] }] };
  const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
  /** Venice and Hive, stubbed: every picture drawn is counted. */
  function fakeMedia() {
    const drawn: string[] = [];
    setMediaFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== VENICE_IMAGE) return new Response("unexpected", { status: 500 });
      drawn.push(String(JSON.parse(String(init?.body)).prompt));
      return Response.json({ id: "x", images: [Buffer.from(PNG).toString("base64")], timing: {} });
    });
    setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD));
    return drawn;
  }
  const media = async (on = true, cookie: string) => settings({ image_provider: "venice", venice_key: "placeholder-venice", ...(on ? { hive_key: "placeholder-hive" } : {}) }, cookie);
  const scenePictures = async () =>
    (await t.db.query<{ scene_chapter: number | null; scene_place: string | null; character_b: string | null }>(`select scene_chapter, scene_place, character_b from adult_images where kind = 'scene' order by created_at`)).rows;

  it("draws one at a chapter's first lines, of the two of them where they are, shown in the gallery with its chapter and place", async () => {
    const { cookie } = await admin();
    await media(true, cookie);
    const drawn = fakeMedia();
    scripted(() => six({ place: "the lighthouse", set: "the lighthouse" }));
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.auto_picture).toBe(true);
    await autoPicturesSettled();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatch(/Setting: the lighthouse\./);
    expect(await scenePictures()).toEqual([{ scene_chapter: 1, scene_place: "the lighthouse", character_b: CAST_B }]);
    const gallery = (await get(cookie)).gallery as { kind: string; chapter: number | null; place: string | null }[];
    expect(gallery.find((m) => m.kind === "scene")).toMatchObject({ chapter: 1, place: "the lighthouse" });
    // The next step at the same place draws nothing.
    const again = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    await autoPicturesSettled();
    expect(again.auto_picture).toBeUndefined();
    expect(drawn).toHaveLength(1);
  });

  it("draws one when the place changes (Set the scene), once per place a chapter", async () => {
    const { cookie } = await admin();
    await media(true, cookie);
    const drawn = fakeMedia();
    scripted(() => six({ place: "the lighthouse", set: "the lighthouse" }));
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const moved = await (await post({ a: CAST_A, b: CAST_B, set_scene: "a boathouse" }, cookie)).json();
    expect(moved.auto_picture).toBe(true);
    await autoPicturesSettled();
    expect((await scenePictures()).map((p) => p.scene_place)).toEqual(["the lighthouse", "a boathouse"]);
    // Back to a place already drawn this chapter: no second picture of it.
    await post({ a: CAST_A, b: CAST_B, set_scene: "the lighthouse" }, cookie);
    await autoPicturesSettled();
    expect(drawn).toHaveLength(2);
  });

  it("a rewind and a redo, or a retry, never draw it twice; a new chapter draws its own", async () => {
    const { cookie } = await admin();
    await media(true, cookie);
    const drawn = fakeMedia();
    scripted(() => six({ place: "the lighthouse", set: "the lighthouse" }));
    await post({ a: CAST_A, b: CAST_B }, cookie);
    await autoPicturesSettled();
    expect(drawn).toHaveLength(1);
    await post({ a: CAST_A, b: CAST_B, redo: true }, cookie);
    await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie);
    await post({ a: CAST_A, b: CAST_B }, cookie);
    await autoPicturesSettled();
    expect(drawn).toHaveLength(1);
    const claimed = (await t.db.query<{ auto_pictures: string[] }>(`select auto_pictures from adult_scenes`)).rows[0].auto_pictures;
    expect(claimed).toEqual([autoPictureKey(1, "the lighthouse")]);
    // Fill the chapter: the next one's first lines draw chapter 2's picture.
    for (let i = 0; i < CHAPTER_LINES / 6; i++) await post({ a: CAST_A, b: CAST_B }, cookie);
    expect((await get(cookie)).scene.chapter).toBe(2);
    await post({ a: CAST_A, b: CAST_B }, cookie);
    await autoPicturesSettled();
    expect((await scenePictures()).map((p) => p.scene_chapter)).toEqual([1, 2]);
  });

  it("none when the setting is off, or when pictures can't be made (no Hive key)", async () => {
    const { cookie } = await admin();
    await media(true, cookie);
    const drawn = fakeMedia();
    expect((await (await settings({ auto_scene_pictures: false }, cookie)).json()).settings.auto_scene_pictures).toBe(false);
    scripted(() => six({ place: "the lighthouse", set: "the lighthouse" }));
    const off = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(off.auto_picture).toBeUndefined();
    await post({ a: CAST_A, b: CAST_B, set_scene: "a boathouse" }, cookie);
    await autoPicturesSettled();
    expect(drawn).toHaveLength(0);
    // On again, but with no output check: media is off, so nothing either.
    await settings({ auto_scene_pictures: true, hive_key: "" }, cookie);
    await post({ a: CAST_A, b: CAST_B, reset: true }, cookie);
    const noHive = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    await autoPicturesSettled();
    expect(noHive.auto_picture).toBeUndefined();
    expect(drawn).toHaveLength(0);
    expect(await scenePictures()).toEqual([]);
  });

  it("a picture that doesn't come never fails the step", async () => {
    const { cookie } = await admin();
    await media(true, cookie);
    setMediaFetchForTests(async () => new Response("down", { status: 503 }));
    setCheckFetchForTests(async () => Response.json(CLEAN_MOD));
    scripted(() => six({ place: "the lighthouse", set: "the lighthouse" }));
    const r = await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(r.status).toBe(200);
    await autoPicturesSettled();
    expect(await scenePictures()).toEqual([]);
  });

  it("a picture that didn't come gives its claim back and is drawn on a later step, but not straight away (2026-10-23)", async () => {
    const { cookie } = await admin();
    await media(true, cookie);
    let now = 1_000_000;
    setAutoPictureClockForTests(() => now);
    try {
      // The first try: Hive busy, so the check can't run and the picture is discarded.
      setCheckFetchForTests(async () => new Response("slow down", { status: 429 }));
      setMediaFetchForTests(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
      scripted(() => six({ place: "the lighthouse", set: "the lighthouse" }));
      await post({ a: CAST_A, b: CAST_B }, cookie);
      await autoPicturesSettled();
      expect(await scenePictures()).toEqual([]);
      expect((await t.db.query<{ auto_pictures: string[] }>(`select auto_pictures from adult_scenes`)).rows[0].auto_pictures).toEqual([]);
      // Hive answers again, but the next step comes too soon: nothing is drawn yet.
      const drawn = fakeMedia();
      const soon = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
      await autoPicturesSettled();
      expect(soon.auto_picture).toBeUndefined();
      expect(drawn).toHaveLength(0);
      // Past the wait, the next step draws it, once.
      now += RETRY_AFTER_MS + 1;
      const later = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
      await autoPicturesSettled();
      expect(later.auto_picture).toBe(true);
      expect(await scenePictures()).toEqual([{ scene_chapter: 1, scene_place: "the lighthouse", character_b: CAST_B }]);
      await post({ a: CAST_A, b: CAST_B }, cookie);
      await autoPicturesSettled();
      expect(drawn).toHaveLength(1);
    } finally {
      setAutoPictureClockForTests(null);
    }
  });
});

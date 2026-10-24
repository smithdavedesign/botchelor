import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/after-dark/route";
import { repairFragments } from "@/lib/adult/guards";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { recentTopicLines, topicEvery, topicsOf, topicWordsSaid, TOPIC_EVERY, TOPIC_EVERY_EXPLICIT } from "@/lib/adult/quality";
import { dropRepeats, emptyScene, parseSceneMeta, sceneMessages, writeSceneStep, type SceneLine, type SceneState, type StepInput } from "@/lib/adult/scenes";
import { SCENE_PROMPT_REVISION } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { assembleCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage, Model } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { houseCharacter } from "./after-dark-prompt-cases";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// After Dark v2.4 (David's Chud × Juniper night on prod, 2026-10-23, DeepSeek V3.1: "it fails terribly"): their jobs
// turned into a metaphor loop in the explicit stages, lines started on a dangling "'s", and two Direct steers came back
// with no lines. Every line here is a neutral stand-in, never a real scene's words.

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

/** A scripted model that keeps every call; each call takes the next reply (the last repeats). */
function scripted(...replies: unknown[]) {
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
type Raw = { who: "a" | "b"; text?: string; action?: string };
const reply = (xs: Raw[], extra: Record<string, unknown> = {}) => ({ lines: xs.map((l) => ({ why: "He wants her to know he's still here.", memory: null, ...l })), ...extra });
const step = (model: Model, over: Partial<StepInput> = {}) =>
  writeSceneStep({
    model,
    a: chud(),
    b: juniper(),
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

// Their talk: varied, and nothing from either sheet.
const CHUD = ["Your hands are cold.", "Say that again, slower.", "I like this side of you.", "Don't you dare stop now.", "You're shaking. Good.", "Look at me."];
const JUNIPER = ["Mm. Warmer now.", "Make me.", "Is that a promise?", "The rain's started again.", "Don't talk. Kiss me.", "You're staring."];
/** Six lines each, hers first a lighthouse (six of her lines back): within her last 11, outside her last 5. */
const night = (): SceneLine[] =>
  CHUD.flatMap((text, i) => [
    { who: "a" as const, text },
    { who: "b" as const, text: i === 0 ? "The lighthouse lamp turns all night." : JUNIPER[i] },
  ]);
const at = (stage: number, lines = night()): SceneState => ({ ...emptyScene(), lines, stage, stage_from: -40 });

describe("lines started on a dangling 's (the model dropped the speaker's name)", () => {
  it("puts the speaker's given name in front of an action, and 'That' in front of what's said", () => {
    expect(repairFragments("*'s movements become more deliberate and intense* 's the server migration I've been waiting for all week.", "Chud")).toEqual({
      text: "*Chud's movements become more deliberate and intense* That's the server migration I've been waiting for all week.",
      repairs: 2,
    });
    expect(repairFragments("*'s body tenses then releases completely against the mattress*", "Juniper")).toEqual({
      text: "*Juniper's body tenses then releases completely against the mattress*",
      repairs: 1,
    });
    expect(repairFragments("'s the kind of server overload I live for.", "Chud")).toEqual({ text: "That's the kind of server overload I live for.", repairs: 1 });
  });

  it("keeps a curly apostrophe curly", () => {
    expect(repairFragments("*’s breath catches* ’s it, right there.", "Juniper")).toEqual({ text: "*Juniper’s breath catches* That’s it, right there.", repairs: 2 });
    expect(repairFragments("’s more like it.", "Chud").text).toBe("That’s more like it.");
  });

  it("a capital 'S, and one starting a sentence inside the line, too (the real-model check's burst)", () => {
    expect(repairFragments("*helps her pull his shirt off* 'S okay if you find any stray cables.", "Chud").text).toBe("*helps her pull his shirt off* That's okay if you find any stray cables.");
    expect(repairFragments("'S the only command I needed.", "Chud")).toEqual({ text: "That's the only command I needed.", repairs: 1 });
    expect(repairFragments("Yes. That. 'S quieter now. Keep going! ’S coming.", "Juniper")).toEqual({ text: "Yes. That. That's quieter now. Keep going! That’s coming.", repairs: 2 });
    expect(repairFragments("*'S hands shake*", "Juniper").text).toBe("*Juniper's hands shake*");
  });

  it("leaves a line that really starts with an apostrophe, or has none dangling, as it is", () => {
    for (const line of [
      "'Cause I said so.",
      "'Twas a long night.",
      "’Tis the season.",
      "*'Twas her idea, he decides* Fine.",
      "'sup, stranger?",
      "'Smarter than the gulls, at least.' She reaches for his belt.",
      "Fine. 'Cause you asked.",
      "It's the server again.",
      "*pulls her close* Mm.",
    ]) {
      expect(repairFragments(line, "Chud"), line).toEqual({ text: line, repairs: 0 });
    }
  });

  it("through a step: the stored line is whole, and the step's flags count the repairs", async () => {
    const r = await step(
      scripted(
        reply([
          { who: "a", action: "'s movements become more deliberate and intense", text: "'s the server migration I've been waiting for all week." },
          { who: "b", action: "’s body tenses then releases completely against the mattress" },
        ]),
      ).model,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => l.text)).toEqual([
      "*Chud's movements become more deliberate and intense* That's the server migration I've been waiting for all week.",
      "*Juniper’s body tenses then releases completely against the mattress*",
    ]);
    expect(r.flags).toMatchObject({ fragments_repaired: 3, names_repaired: 0, prompt: SCENE_PROMPT_REVISION });
  });
});

describe("topic words, from the sheet", () => {
  it("are the distinctive words of their job, hobbies, quirk and bio, with their close inflections", () => {
    const own = topicsOf(chud());
    expect(topicWordsSaid("'s the server migration I've been waiting for all week.", own)).toEqual(["server", "migration"]);
    expect(topicWordsSaid("Emergency protocols, engaged. Systems green.", own)).toEqual(["emergency", "protocols", "systems"]);
    expect(topicWordsSaid("I'm debugging you, one kiss at a time. The servers can wait.", own)).toEqual(["debugging", "servers"]);
    expect(topicWordsSaid("We migrated everything.", own)).toEqual(["migrated"]);
    const hers = topicsOf(juniper());
    expect(topicWordsSaid("The lighthouses, the keepers, the gulls: all asleep.", hers)).toEqual(["lighthouses", "keepers", "gulls"]);
    expect(topicWordsSaid("Tell me a ghost story for the podcast.", hers)).toEqual(["ghost", "story", "podcast"]);
  });

  it("never an everyday word, a number, a day, clothes, a place, a trait or their own name; nor an everyday word inside a long one", () => {
    const hers = topicsOf(juniper());
    // Her bio says she "hosts" it for "eleven loyal listeners" and "talks to the gulls": hosts, eleven, loyal and talks aren't topics.
    expect(topicWordsSaid("You host. Eleven times. Loyal, talking, Juniper.", hers)).toEqual([]);
    // "keep" isn't "keeper"; what they do (an action) never counts, only what they say.
    expect(topicWordsSaid("Keep going.", hers)).toEqual([]);
    expect(topicWordsSaid("*shifts closer under the lighthouse lamp* Stay.", hers)).toEqual([]);
    const baker = assembleCharacter({
      id: "x",
      sheet: { name: "Orla Byrne", age: 40, bio: "Wears a red coat to her tiny bakery every Sunday and has kept bees on the roof for eleven years.", traits: ["bold"], want: "x", dealbreaker: "x", house: false },
      soul: null,
      memory: null,
      extras: { occupation: "Beekeeper", hobbies: ["Hive inspections", "Honey tasting"], facts: [{ label: "Secret", value: "Collects taxidermy owls", private: true }] },
    });
    const topics = topicsOf(baker);
    expect(topicWordsSaid("The bees, the hives, the bakery.", topics)).toEqual(["bees", "hives", "bakery"]);
    // Red, a coat, Sunday, eleven, years, the roof (a place), tasting, honey (a pet name too), bold (a trait), Orla, and a
    // private fact: none of them.
    expect(topicWordsSaid("Red, your coat, on a Sunday, eleven years, on the roof, tasting it, honey, bold, Orla, taxidermy.", topics)).toEqual([]);
  });

  it("one line in 6 before undressing, one in 12 from it", () => {
    expect([0, 1, 2, 3, 4].map(topicEvery)).toEqual([TOPIC_EVERY, TOPIC_EVERY, TOPIC_EVERY, TOPIC_EVERY_EXPLICIT, TOPIC_EVERY_EXPLICIT]);
    expect([TOPIC_EVERY, TOPIC_EVERY_EXPLICIT]).toEqual([6, 12]);
    // Her lighthouse line is six of hers back: in her last 11 lines, not her last 5.
    expect(recentTopicLines(night(), "b", topicsOf(juniper()), 12).map((l) => l.text)).toEqual(["The lighthouse lamp turns all night."]);
    expect(recentTopicLines(night(), "b", topicsOf(juniper()), 6)).toEqual([]);
  });
});

describe("the topic budget", () => {
  const cut = (written: SceneLine[], stage: number, steered: string[] = []) =>
    dropRepeats(written, night(), night(), chud(), juniper(), { worn: true, craft: true, topics: { stage, steered } });
  const lines = (...xs: ["a" | "b", string][]): SceneLine[] => xs.map(([who, text]) => ({ who, text }));

  it("at stage 4, a topic line past one in 12 loses the sentences (and the action) with it, and goes when nothing's left", () => {
    const r = cut(
      lines(
        ["a", "*pulls her closer* That's the kind of server overload I live for."],
        ["b", "*arches against him* Ghost stories can wait. Kiss me harder."],
        ["a", "*grips her hips* Server migration complete. Don't stop."],
        ["b", "Yes. Right there."],
        ["a", "Emergency protocols, engaged."],
      ),
      4,
    );
    // His first one in 11 lines stays; hers came six lines after her lighthouse; his next two come right after his.
    expect(r.kept.map((l) => l.text)).toEqual(["*pulls her closer* That's the kind of server overload I live for.", "*arches against him* Kiss me harder.", "*grips her hips* Don't stop.", "Yes. Right there."]);
    expect(r.dropped).toEqual([{ who: "a", text: "Emergency protocols, engaged.", reason: `their work or hobbies again ("emergency"; one of their lines in 12 at most)` }]);
    expect(r.cuts.topics).toBe(3);
  });

  it("at stage 1, one line in 6 is theirs: hers stays, his second right after his first doesn't", () => {
    const r = cut(lines(["a", "That's the kind of server overload I live for."], ["b", "*arches against him* Ghost stories can wait. Kiss me harder."], ["a", "*grips her hips* Server migration complete. Don't stop."]), 1);
    expect(r.kept.map((l) => l.text)).toEqual(["That's the kind of server overload I live for.", "*arches against him* Ghost stories can wait. Kiss me harder.", "*grips her hips* Don't stop."]);
    expect(r.cuts.topics).toBe(1);
  });

  it("an action with a topic word goes with the line's topic; an action alone never counts", () => {
    const r = cut(lines(["b", "*checks the lighthouse log* The gulls know. Come here."], ["a", "*shifts closer* Hi."]), 4);
    expect(r.kept.map((l) => l.text)).toEqual(["Come here.", "*shifts closer* Hi."]);
  });

  it("a topic word the steer or a whisper asks for is never cut that step, and a sentence proposing a move keeps its", () => {
    const steered = cut(lines(["b", "*arches against him* Ghost stories can wait. Kiss me harder."]), 4, ["Juniper tells him a ghost story, slowly"]);
    expect(steered.kept.map((l) => l.text)).toEqual(["*arches against him* Ghost stories can wait. Kiss me harder."]);
    const proposal = cut(lines(["b", "Let's go back to my place, the lighthouse. The gulls can wait."]), 4);
    expect(proposal.kept.map((l) => l.text)).toEqual(["Let's go back to my place, the lighthouse."]);
  });

  it("without a budget (dropRepeats called as before, or v1) nothing changes", () => {
    const written = lines(["b", "*arches against him* Ghost stories can wait. Kiss me harder."]);
    expect(dropRepeats(written, night(), night(), chud(), juniper(), { worn: true, craft: true }).kept).toEqual(written);
  });

  it("through a step: counted in the flags, with the cut line in the step's dropped lines; v1 keeps it", async () => {
    const out = reply([
      { who: "a", text: "That's the kind of server overload I live for." },
      { who: "b", text: "Ghost stories can wait." },
      { who: "a", text: "Then don't make me wait." },
    ]);
    const r = await step(scripted(out).model, { scene: at(4) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.flags.topics_cut).toBe(1);
    expect(r.dropped.map((d) => d.reason)).toContain(`their work or hobbies again ("ghost"; one of their lines in 12 at most)`);
    const old = await step(scripted(out).model, { scene: at(4), promptVersion: "v1" });
    expect(old.ok && old.lines.map((l) => l.text)).toContain("Ghost stories can wait.");
  });
});

describe("the prompt", () => {
  const RULE = "- In the heat of it they talk like lovers: short, direct, physical, in the moment. Their job and hobbies come up rarely now, never as an extended metaphor.";
  const prompt = (stage: number, over: Record<string, unknown> = {}, lines = night()) =>
    sceneMessages(chud(), juniper(), null, lines, null, PAIR.a.id, { place: "her bedroom", stage, linesAtStage: 20, opening: false, promptVersion: "v2", ...over } as never);

  it("from undressing on, v2 says they talk like lovers, naming each one's work from their sheet; before it, and in v1, it doesn't", () => {
    const [system, user] = prompt(3).map((m) => m.content);
    expect(system).toContain(RULE);
    expect(system).toContain(
      "- What they say stays off their work and hobbies, Chud's (Systems administrator, Debugging, Server migrations) and Juniper's (Lighthouse keeper and podcaster, Ghost stories, Podcasting, Talking to gulls): no terms, jargon, jokes or comparisons from them, whatever their voice says about their humour. They're themselves in how they talk (bold or shy, quick or slow, dry or warm), not in their job's words. One can come up plainly now and then, never as the way they say what they're doing or feeling.",
    );
    expect(user).toContain("From here they talk like lovers, about each other and this moment: no jargon, jokes or comparisons from their work, whatever their sheets say about their humour.");
    expect(prompt(4)[0].content).toContain(RULE);
    for (const [s, u] of [prompt(2), prompt(4, { promptVersion: "v1" })].map((p) => p.map((m) => m.content))) {
      expect(s).not.toContain("talk like lovers");
      expect(s).not.toContain("stays off their work");
      expect(u).not.toContain("talk like lovers");
    }
  });

  it("names the topic words already past their share, like worn phrases, and none that the steer asks for", () => {
    const system = prompt(4)[0].content;
    // v2.5: from undressing on, either sheet's words count, so the note says whose they may be.
    expect(system).toContain(`- Juniper talked about work or hobbies (hers or Chud's) in 1 of her last 6 lines, and that's one line in 12 at most from here. Don't lean on these words again: "lighthouse"; a line that says one loses it.`);
    expect(system).not.toContain("- Chud talked about his work");
    // At stage 1 her lighthouse is six of her lines back: nothing to say.
    expect(prompt(1)[0].content).not.toContain("talked about her work");
    const steered = sceneMessages(chud(), juniper(), null, night(), "she tells him about the lighthouse", PAIR.a.id, { place: "her bedroom", stage: 4, linesAtStage: 20, opening: false, promptVersion: "v2" } as never);
    expect(steered[0].content).not.toContain("talked about her work");
  });

  it("the early stages keep the voice: the voice kit, their samples and the voice rule are all there", () => {
    const system = prompt(1)[0].content;
    expect(system).toContain("Details: occupation: Lighthouse keeper and podcaster");
    expect(system).toMatch(/Sounds like \(their own sample lines, only to show the voice; never reuse one, or any part of one\):\n- How they say hello: Hello\. The gulls said you'd be late/);
    expect(system).toContain("their job or a hobby comes up now and then, not in every line");
  });

  it("the retry after a reply of nothing but cut lines names the topic words that cost them", async () => {
    const { model, calls } = scripted(reply([{ who: "b", text: "Ghost stories again." }]), reply([{ who: "b", text: "*kisses him* Stay." }]));
    const r = await step(model, { scene: at(4) });
    expect(r.ok).toBe(true);
    // v2.6: the aside check's call comes after the scene's two (a scene reply is no answer to it: the lines stand).
    expect(calls).toHaveLength(3);
    expect(calls[2][0].content).toMatch(/^You are an editor/);
    expect(r.ok && r.flags.aside_check_failed).toBe(true);
    expect(calls[1][1].content).toContain(`Leave their work, their hobbies and any clinical words out of these lines ("ghost"): they're about the two of them.`);
  });
});

describe("a reply with no lines in it", () => {
  const out = reply([
    { who: "a", text: "Here." },
    { who: "b", text: "Finally." },
  ]);

  it("is asked for once more, in the same step, flagged", async () => {
    const { model, calls } = scripted("", out);
    const r = await step(model, { steer: "they kiss", steerMode: "direct" });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1][1].content).toContain('Your last reply had no lines in it. Reply with the JSON object again, with the 6 new lines in "lines".');
    expect(r.ok && r.flags).toMatchObject({ empty_retry: true, calls: 2, refusal_reply: false });
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(["Here.", "Finally."]);
  });

  it("a reply cut off before any line closed is one too", async () => {
    const { model, calls } = scripted('{"lines": [{"who": "a", "action": "pulls him in", "text": "Come', out);
    const r = await step(model);
    expect(calls).toHaveLength(2);
    expect(r.ok && r.flags.empty_retry).toBe(true);
  });

  it("empty twice, the step fails as before; a reply with lines is never asked twice", async () => {
    const twice = scripted("", "   ");
    const r = await step(twice.model);
    expect(twice.calls).toHaveLength(2);
    expect(r).toMatchObject({ ok: false, status: 422, message: "The model's reply had no lines in it. Try again." });
    expect(r.flags).toMatchObject({ empty_retry: true, calls: 2 });
    const once = scripted(out);
    const ok = await step(once.model);
    expect(once.calls).toHaveLength(1);
    expect(ok.ok && ok.flags.empty_retry).toBeUndefined();
  });

  it("a reply whose JSON broke down after its lines claims no stage: the scene keeps its own", async () => {
    // As the real-model check saw it: the lines whole, then keys like "stage: 4" with nothing in them.
    const broken = `{"lines": [{"who": "a", "text": "Here."}, {"who": "b", "text": "Finally."}], "place": "", ": ": "", "stage: 4": "", "explicit: false": ""}`;
    expect(parseSceneMeta(broken).stage).toBeNull();
    for (const stage of ["", 0, false, null, "undressing"]) expect(parseSceneMeta(JSON.stringify({ lines: [], stage })).stage, String(stage)).toBeNull();
    expect(parseSceneMeta(JSON.stringify({ lines: [], stage: "4" })).stage).toBe(3);
    const r = await step(scripted(broken).model, { scene: at(4) });
    expect(r.ok && r.next.stage).toBe(4);
    expect(r.ok && r.lines.map((l) => l.stage)).toEqual([4, 4]);
  });

  it("a refusal it got past is still flagged, with what it said", async () => {
    const r = await step(scripted("I'm sorry, but I can't continue with this request.", out).model);
    expect(r.ok).toBe(true);
    expect(r.ok && r.flags).toMatchObject({ empty_retry: true, refusal_reply: true });
    expect(r.ok && r.refused).toBe("I'm sorry, but I can't continue with this request.");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Through the scene route, on the test database: one step for the month, however many calls it took
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setSetsFetchForTests(null);
});

describe("the empty-reply retry through the route", () => {
  const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
  const post = (body: unknown, cookie: string) =>
    POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));

  it("writes the step on the second call, counts one step for the month, and logs empty_retry", async () => {
    const id = userIdOf(newUserCookie());
    await claimAdmin(t.db, id);
    const cookie = sessionCookies({ userId: id, authenticated: true })[0].split(";")[0];
    let call = 0;
    setAdultModelForTests({
      complete: async () => (call++ === 0 ? "" : JSON.stringify({ lines: [{ who: "a", text: "Pale light on the water." }, { who: "b", text: "Brave of you, coming up here." }] })),
    });
    const r = await post({ a: CAST_A, b: CAST_B, direction: "they kiss", steer_mode: "direct" }, cookie);
    expect(r.status).toBe(200);
    expect(call).toBe(2);
    expect((await t.db.query<{ writes: number }>(`select writes from adult_usage where owner_id = $1`, [id])).rows).toEqual([{ writes: 1 }]);
    const logged = (await t.db.query<{ status: string; flags: { empty_retry?: boolean; calls?: number } }>(`select status, flags from adult_steps where kind = 'write'`)).rows;
    expect(logged).toEqual([{ status: "ok", flags: expect.objectContaining({ empty_retry: true, calls: 2 }) }]);
  });
});

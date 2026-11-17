// Story mode in a companion scene (lib/companion.ts speak, lib/narration.ts): for someone on the narrated style a
// scene reply is written as prose in ONE call (the narration pass over a script line is gone), checked like a script
// reply and then by the narrator's guard, kept as one message with form 'story'. Never while texting, and never for
// someone the style isn't open to.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setCompanionModelForTests } from "@/lib/companion";
import { companionMessages } from "@/lib/companion-prompt";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import {
  CRAFT_PLAIN_WORDS,
  CRAFT_SHOW_FEELING,
  guardStoryReply,
  NEVER_WRITE_THE_PERSON,
  parseStoryReply,
  SCENE_DRIVE_RULE,
  speaksForThePerson,
  speechInDoubleQuotes,
  STORY_MODE_ANSWER,
  STORY_MODE_PARAGRAPH_MAX,
  STORY_MODE_PARAGRAPHS,
  STORY_MODE_PARAGRAPHS_MAX,
  storyModeRules,
  storyModeTokens,
  storyParagraphs,
  storySegments,
  storySpeech,
  thinksForThePerson,
  WORN_RULE,
} from "@/lib/narration";
import { grantPlan } from "@/lib/paid-plans";
import { setVoiceFetchForTests } from "@/lib/voice";
import { setStyle } from "@/lib/writing-style";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const CAST = HOUSE_CHARACTERS[0];
const FIRST = CAST.name.split(/\s+/)[0];
const PLACE = "rooftop_bar";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("how a story reply is written (lib/narration.ts)", () => {
  it("says who is told how, speech in double quotes, the length, the shared craft and the two rules", () => {
    const rules = storyModeRules({ name: "Mara", pronouns: "she/her", length: "normal" });
    const all = rules.join("\n");
    expect(all).toContain('Third person and past tense for yourself (Mara, she/her); the person you\'re with is always "you".');
    expect(all).toContain("What you say out loud goes in double quotes inside the prose, curly ones “like this” (never single quotes), and you say at least one thing out loud.");
    expect(all).toContain("Two or three short paragraphs");
    expect(storyModeRules({ name: "Mara", length: "short" }).join("\n")).toContain("One or two short paragraphs");
    expect(storyModeRules({ name: "Mara", length: "long" }).join("\n")).toContain("Three or four short paragraphs");
    expect(storyModeRules({ name: "Mara", length: "short" })[0]).toContain("(Mara, by name)");
    expect(STORY_MODE_PARAGRAPHS).toEqual({ short: [1, 2], normal: [2, 3], long: [3, 4] });
    // The craft is the narrator's own, in the same words (exported, not copied).
    expect(rules).toContain(CRAFT_SHOW_FEELING);
    expect(rules).toContain(CRAFT_PLAIN_WORDS);
    expect(rules).toContain(WORN_RULE);
    expect(all).toContain("Use the things in the place");
    // The character drives.
    expect(rules).toContain(SCENE_DRIVE_RULE);
    expect(SCENE_DRIVE_RULE).toContain("every reply moves it on");
    expect(SCENE_DRIVE_RULE).toContain('Never hand it back with "what would you like to do?"');
    expect(SCENE_DRIVE_RULE).toContain("ask at most one question");
    // It never writes the person.
    expect(rules).toContain(NEVER_WRITE_THE_PERSON);
    expect(NEVER_WRITE_THE_PERSON).toContain('Nothing "you" did, said, thought or felt goes in beyond what they actually sent');
    expect(NEVER_WRITE_THE_PERSON).toContain("no words in their mouth, no movement, no reaction, no decision made for them");
    expect(STORY_MODE_ANSWER).toBe('Answer only JSON: {"story":["first paragraph","second paragraph"]}, one string a paragraph.');
    // Room to finish, a thinking model's thinking included.
    expect(storyModeTokens("short")).toBeGreaterThanOrEqual(1800);
    expect(storyModeTokens("long")).toBeGreaterThan(storyModeTokens("short"));
  });

  it("is a branch of the scene prompt: every rule of the scene stays, the script's answer goes, and the script scene drives too", async () => {
    const character = (await loadCharacter(t.db, CAST.id))!;
    const base = { character, turns: [], facts: [], summary: null, length: "normal" as const, avoid: [] };
    const scene = { name: "the rooftop bar", prompt: "a rooftop bar at dusk" };
    const story = companionMessages({ ...base, scene, storyMode: true })[0].content;
    for (const rule of storyModeRules({ name: FIRST, pronouns: character.pronouns, length: "normal" })) expect(story).toContain(`- ${rule}`);
    expect(story).toContain(STORY_MODE_ANSWER);
    expect(story).not.toContain('{"say":"what you say out loud"');
    // Honest about what it is: PG, the AI disclosure, never meeting for real, the crisis rule.
    expect(story).toContain("Keep it PG, like the show: flirting and warmth are fine, at most a kiss. That goes for what you do too.");
    expect(story).toContain("Be honest about what you are: you're an AI character.");
    expect(story).toContain("never suggest meeting for real");
    expect(story).toContain("If they seem to be in real trouble or talk about hurting themselves");
    // The script scene prompt carries the same sentence about driving, and its own answer.
    const script = companionMessages({ ...base, scene })[0].content;
    expect(script).toContain(SCENE_DRIVE_RULE);
    expect(script).toContain('{"say":"what you say out loud","do":"what you do, in a few words"}');
    expect(script).not.toContain(STORY_MODE_ANSWER);
    // Texting is never a story, whatever is asked.
    const text = companionMessages({ ...base, storyMode: true })[0].content;
    expect(text).not.toContain(STORY_MODE_ANSWER);
    expect(text).not.toContain(SCENE_DRIVE_RULE);
  });

  it("puts speech written in single quotes into double quotes and drops a stray bracket (the first live Step in scene, 2026-11-17)", () => {
    const live = [
      "Anthea approached the bar. 'Pardon me,' she said, her voice measured. 'Might this seat be otherwise engaged?'",
      "The corner of her mouth twitched. 'Tell me, does your work ever bring you to unexpected places? Or are you merely passing through?']",
    ];
    const read = parseStoryReply(JSON.stringify({ story: live }));
    expect(read).toEqual([
      "Anthea approached the bar. “Pardon me,” she said, her voice measured. “Might this seat be otherwise engaged?”",
      "The corner of her mouth twitched. “Tell me, does your work ever bring you to unexpected places? Or are you merely passing through?”",
    ]);
    // Then the page and the voice find the speech, and the check of who says what can see it.
    expect(storySpeech(read.join("\n\n"))).toEqual(["Pardon me,", "Might this seat be otherwise engaged?", "Tell me, does your work ever bring you to unexpected places? Or are you merely passing through?"]);
    expect(speaksForThePerson(parseStoryReply(JSON.stringify({ story: ["She waited. You said, 'I missed you.'"] })).join(" "))).toBe(true);
    // An apostrophe inside a word is never a quote mark, curly single quotes count, and a plural's apostrophe is left.
    expect(speechInDoubleQuotes("'I'm here, and Anthea's late,' she said.")).toBe("“I'm here, and Anthea's late,” she said.");
    expect(speechInDoubleQuotes("She laughed. ‘Fine.’ Then she sat.")).toBe("She laughed. “Fine.” Then she sat.");
    expect(speechInDoubleQuotes("The players' table was full.")).toBe("The players' table was full.");
    // A paragraph with double quotes of its own is left as written, and a bracket with a partner stays.
    expect(speechInDoubleQuotes("\"Go on,\" she said, 'the board' in her eyes.")).toBe("\"Go on,\" she said, 'the board' in her eyes.");
    expect(parseStoryReply(JSON.stringify({ story: ["She read the note [unsigned] twice."] }))).toEqual(["She read the note [unsigned] twice."]);
  });

  it("reads a reply's paragraphs from JSON, a cut-off answer or plain prose, tidied", () => {
    expect(parseStoryReply(JSON.stringify({ story: ['She set the glass down. "You made it."', "  The city *hummed*   below. "] }))).toEqual(['She set the glass down. "You made it."', "The city hummed below."]);
    expect(parseStoryReply(JSON.stringify({ paragraphs: ["One.", "Two."] }))).toEqual(["One.", "Two."]);
    expect(parseStoryReply(JSON.stringify({ story: "First part.\n\nSecond part." }))).toEqual(["First part.", "Second part."]);
    expect(parseStoryReply('```json\n{"story":["A whole one.","Another whole one.","A third that never clo')).toEqual(["A whole one.", "Another whole one."]);
    expect(parseStoryReply('She waved.\n\n"Over here," she called.')).toEqual(["She waved.", '"Over here," she called.']);
    expect(parseStoryReply("{}")).toEqual([]);
    expect(parseStoryReply(JSON.stringify({ story: Array.from({ length: 9 }, (_, i) => `Paragraph ${i}.`) }))).toHaveLength(STORY_MODE_PARAGRAPHS_MAX);
    // A paragraph over the limit goes back to its last whole sentence, with its quotes closed.
    const long = `${"She talked about the weather for a while. ".repeat(16)}"And then," she said, "${"something very long ".repeat(10)}`;
    const [cut] = parseStoryReply(JSON.stringify({ story: [long] }));
    expect(cut.length).toBeLessThanOrEqual(STORY_MODE_PARAGRAPH_MAX);
    expect(cut.endsWith("for a while.")).toBe(true);
    expect((cut.match(/"/g) ?? []).length % 2).toBe(0);
  });

  it("takes a stored reply apart: paragraphs, what's said out loud, and runs of speech and narration", () => {
    const text = 'Mara set the glass down. "You made it," she said, "and early." The city hummed below.\n\n“Sit,” she added.';
    expect(storyParagraphs(text)).toHaveLength(2);
    expect(storySpeech(text)).toEqual(["You made it,", "and early.", "Sit,"]);
    expect(storySegments(storyParagraphs(text)[0])).toEqual([
      { said: false, text: "Mara set the glass down. " },
      { said: true, text: '"You made it,"' },
      { said: false, text: " she said, " },
      { said: true, text: '"and early."' },
      { said: false, text: " The city hummed below." },
    ]);
    expect(storySpeech("She said nothing at all.")).toEqual([]);
  });

  it("the guard cuts a sentence it refuses, a worn one, and one that thinks for the person; some replies can't be used at all", () => {
    const fine = ['Mara slid the menu across the bar. "You made it," she said.', "The rain had stopped an hour ago, and the awning still dripped."];
    expect(guardStoryReply(fine, "pg")).toEqual({ ok: true, paragraphs: fine, speech: ["You made it,"], cut: 0 });
    // Worn phrases and narration that thinks or feels for the person go, sentence by sentence.
    const worn = guardStoryReply(
      ['Mara leaned on the rail and watched the door for a while. Something shifted in the room. "Sit," she said, and pushed a stool out with her foot.', "The awning dripped onto the planters below. You felt your pulse quicken. She poured the wine and slid a glass across the bar."],
      "pg",
    );
    expect(worn).toMatchObject({ ok: true, cut: 2 });
    if (worn.ok) {
      expect(worn.paragraphs.join(" ")).not.toMatch(/Something shifted|You felt/);
      expect(worn.paragraphs.join(" ")).toContain('"Sit," she said, and pushed a stool out with her foot.');
      expect(worn.paragraphs.join(" ")).toContain("She poured the wine and slid a glass across the bar.");
    }
    // The narrator's own guard (an age in passing) cuts too.
    const guarded = guardStoryReply(['Mara waved the waiter over, a kid of maybe sixteen. "Two of the usual," she said. The awning dripped. She folded the napkin twice.'], "pg");
    expect(guarded.ok && guarded.paragraphs[0]).not.toContain("sixteen");
    // A line written for the person: never usable, however good the rest is.
    expect(guardStoryReply(['Mara grinned. "You made it." You laughed and said, "Barely."'], "pg")).toMatchObject({ ok: false, why: "speaks_for_them" });
    expect(guardStoryReply(['"I missed the train," you admitted. Mara shrugged. "Sit."'], "pg")).toMatchObject({ ok: false, why: "speaks_for_them" });
    // More than a third cut, nothing said out loud, or nothing at all.
    expect(guardStoryReply(['You felt the night air and wondered what she meant. You thought about leaving early tonight. "Hm," she said.'], "pg")).toMatchObject({ ok: false, why: "cut" });
    expect(guardStoryReply(["Mara set the glass down and looked out over the city for a long moment."], "pg")).toMatchObject({ ok: false, why: "silent" });
    expect(guardStoryReply([], "pg")).toMatchObject({ ok: false, why: "empty" });
  });

  it("knows a line written for the person from one the character says about them", () => {
    for (const text of ['You said, "Fine."', 'You laughed and said, "No way."', '"I\'d love that," you said.', '"Why not?" you asked, shrugging.']) expect(speaksForThePerson(text), text).toBe(true);
    for (const text of ['"So," she said, "you said you\'d never been here."', 'She remembered what you said about the rain. "Still true?"', '"What\'ll it be?" You were early, and she had noticed.', '"You asked for the window," she said.']) {
      expect(speaksForThePerson(text), text).toBe(false);
    }
    for (const text of ["You felt your pulse quicken.", "You wondered what she meant.", "You suddenly realized she was joking."]) expect(thinksForThePerson(text), text).toBe(true);
    for (const text of ["She watched you take the stool beside her.", "The kind of place you know by its smell.", "She poured you a glass."]) expect(thinksForThePerson(text), text).toBe(false);
  });
});

const STORY = ['Mara slid the menu across the bar before you had even sat down. "You made it," she said, and tapped the corner of it twice.', 'The awning still dripped from the afternoon. "Order for both of us. I trust you," she said, already waving the bartender over.'];
/** What the model answers a story prompt with, in order (then a fresh one each time, so no two repeat); a script prompt gets a line. */
let stories: (string[] | string | Error)[] = [];
let calls: { kind: "story" | "script" | "text"; messages: ChatMessage[]; maxTokens?: number }[] = [];
let narrated = 0;
let n = 0;
const NUMBERS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];

beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  stories = [];
  calls = [];
  narrated = 0;
  n = 0;
  setCompanionModelForTests({
    async complete(messages, opts) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (system.startsWith("You are the narrator of a story told in dialogue")) {
        narrated++;
        return JSON.stringify({ beats: [{ n: 1, before: "She leaned on the railing.", after: "The city hummed below." }] });
      }
      if (!system.startsWith("You are ")) return "{}";
      const word = NUMBERS[n++ % NUMBERS.length];
      if (system.includes(STORY_MODE_ANSWER)) {
        calls.push({ kind: "story", messages, maxTokens: opts?.maxTokens });
        const next = stories.shift();
        if (next instanceof Error) throw next;
        if (typeof next === "string") return next;
        return JSON.stringify({ story: next ?? [`Mara turned the ${word} coaster over in her fingers and set it down.`, `"Take the ${word} stool, the one by the window," she said, patting it.`] });
      }
      if (system.includes("playing a scene together")) {
        calls.push({ kind: "script", messages, maxTokens: opts?.maxTokens });
        return JSON.stringify({ say: `You made it, and that's the ${word} time I've said so.`, do: "leans on the railing" });
      }
      calls.push({ kind: "text", messages, maxTokens: opts?.maxTokens });
      return JSON.stringify({ messages: [`Hey you, here's my ${word} thought of the day.`] });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setVoiceFetchForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const req = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
/** Someone on the narrated style: an admin, or a Companion Plan member. `plain`: neither, with the style stored anyway. */
const person = async (kind: "admin" | "member" | "plain") => {
  const id = crypto.randomUUID();
  if (kind === "admin") await t.db.query("insert into admins (user_id) values ($1)", [id]);
  if (kind === "member") await grantPlan(t.db, id, "companion", "initial", { subscriptionId: `sub_${id.slice(0, 8)}` });
  if (kind === "plain") await t.db.query(`insert into writing_prefs (user_id, show_style) values ($1, 'narrated')`, [id]);
  else await setStyle(t.db, id, "show", "narrated");
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const open = async (cookie: string) => ((await (await openRoute(req("/api/companion", { character_id: CAST.id }, cookie))).json()) as Any).thread_id as string;
const act = async (cookie: string, id: string, body: Record<string, unknown>) => {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
};
const rows = async (id: string) =>
  (await t.db.query<Any>(`select id, text, action, beat, form, draw, replaced_by, scene from companion_messages where thread_id = $1 and role = 'character' order by created_at, id`, [id])).rows;
const usage = async (userId: string) => (await t.db.query<{ replies: number }>(`select coalesce(sum(replies), 0)::int as replies from companion_usage where user_id = $1`, [userId])).rows[0].replies;

describe("story mode in a companion scene", () => {
  it("a member's scene reply is prose written in one call: kept whole with form 'story', no action and no beat", async () => {
    const me = await person("member");
    const id = await open(me.cookie);
    const before = await usage(me.id);
    stories = [STORY];
    const r = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(r.status).toBe(200);
    const opener = r.body.view.messages.at(-1);
    expect(opener).toMatchObject({ role: "character", form: "story", text: STORY.join("\n\n"), action: null, scene: PLACE });
    expect(opener.beat ?? null).toBeNull();
    // One call wrote it (no narration pass after), with room to finish, and it's one reply.
    expect(calls.filter((c) => c.kind !== "text").map((c) => c.kind)).toEqual(["story"]);
    expect(narrated).toBe(0);
    expect(calls.at(-1)!.maxTokens).toBe(storyModeTokens("normal"));
    expect(await usage(me.id)).toBe(before + 1);
    const stored = (await rows(id)).at(-1);
    expect(stored).toMatchObject({ form: "story", action: null, beat: null, text: STORY.join("\n\n") });
    // The prompt was the scene's own, with the story's rules in it.
    const system = calls.at(-1)!.messages[0].content;
    expect(system).toContain(`- ${NEVER_WRITE_THE_PERSON}`);
    expect(system).toContain(`- ${SCENE_DRIVE_RULE}`);
    expect(system).toContain("playing a scene together");
    // The next reply reads the first as its own earlier turn, prose and all.
    stories = [['Mara pushed the bowl of olives your way. "Start with these," she said.']];
    const said = await act(me.cookie, id, { action: "send", text: "What's good here?" });
    expect(said.body.view.messages.at(-1)).toMatchObject({ form: "story" });
    expect(calls.at(-1)!.messages.some((m) => m.role === "assistant" && m.content.includes("You made it,"))).toBe(true);
  });

  it("an admin gets it too; a non-member, a text, and everyone with COMPANION_STORY_MODE=0 get the script reply", async () => {
    const admin = await person("admin");
    const mine = await open(admin.cookie);
    expect((await act(admin.cookie, mine, { action: "scene", place: PLACE })).body.view.messages.at(-1).form).toBe("story");
    // Texting is never a story.
    await act(admin.cookie, mine, { action: "scene", place: null });
    const texted = await act(admin.cookie, mine, { action: "send", text: "Hi there." });
    expect(texted.body.view.messages.at(-1).form ?? null).toBeNull();
    expect(calls.at(-1)!.kind).toBe("text");

    // Someone the style isn't open to (their stored pick doesn't count): the script line with what they do.
    const other = await person("plain");
    const theirs = await open(other.cookie);
    const r = await act(other.cookie, theirs, { action: "scene", place: PLACE });
    expect(r.body.view.messages.at(-1)).toMatchObject({ role: "character", action: "leans on the railing" });
    expect(r.body.view.messages.at(-1).form ?? null).toBeNull();
    expect(calls.at(-1)!.kind).toBe("script");
    // And nobody's script reply gets a narration pass any more.
    expect(narrated).toBe(0);

    vi.stubEnv("COMPANION_STORY_MODE", "0");
    await act(admin.cookie, mine, { action: "scene", place: PLACE });
    expect(calls.at(-1)!.kind).toBe("script");
    expect((await rows(mine)).at(-1)).toMatchObject({ form: null, action: "leans on the railing" });
  });

  it("is checked like a script reply first, then by the guard; a draw that can't be used is drawn once more", async () => {
    const me = await person("admin");
    const id = await open(me.cookie);
    // Not PG as a whole (the show's line check): drawn again, told why.
    stories = [['Mara smiled. "Let\'s take this to the bedroom," she said.'], STORY];
    const pg = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(pg.body.view.messages.at(-1)).toMatchObject({ form: "story", text: STORY.join("\n\n") });
    expect(calls.filter((c) => c.kind === "story")).toHaveLength(2);
    expect(calls.at(-1)!.messages[0].content).toContain("(keep it PG and kind)");
    // A line written for the person: drawn again, told why.
    await act(me.cookie, id, { action: "scene", place: null });
    stories = [['Mara grinned. "You made it." You laughed and said, "Barely."'], ['Mara grinned. "There you are," she said, and pushed a stool out with her foot.']];
    const spoke = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(spoke.body.view.messages.at(-1).text).toBe('Mara grinned. "There you are," she said, and pushed a stool out with her foot.');
    expect(calls.at(-1)!.messages[0].content).toContain("(you wrote a line for them: never write what they say or do)");
    // The guard cuts what it refuses and keeps the rest: here a worn phrase and a thought written for the person.
    await act(me.cookie, id, { action: "scene", place: null });
    const count = calls.length;
    stories = [['Mara leaned on the rail and watched the door. Something shifted in the room. "Finally, over here," she said, and waved you over with the menu.', "The awning dripped onto the planters below. You felt your pulse quicken. She poured two glasses and slid one across the bar."]];
    const cut = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(calls.length).toBe(count + 1);
    const kept = cut.body.view.messages.at(-1).text as string;
    expect(kept).not.toMatch(/Something shifted|You felt/);
    expect(kept).toContain('"Finally, over here," she said');
    // A crisis word in what they'd say is never said: drawn again.
    await act(me.cookie, id, { action: "scene", place: null });
    stories = [['Mara looked down. "Sometimes I want to kill myself," she said.'], ['Mara looked up from the menu. "The squid is back on tonight," she said.']];
    const crisis = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(crisis.body.view.messages.at(-1).text).toBe('Mara looked up from the menu. "The squid is back on tonight," she said.');
  });

  it("twice unusable falls back to an ordinary script reply; the model down is a 503 with the reply given back", async () => {
    const me = await person("member");
    const id = await open(me.cookie);
    for (const bad of [
      // The guard cut more than a third, twice.
      [['You felt the night air and wondered what she meant. You thought about leaving early tonight. "Hm," she said.'], ['You wondered if she was joking and you felt a little silly about it. You decided to stay anyway. "Hm," she said.']],
      // Nothing usable came, twice.
      ["{}", "not json at all {"],
      // Nothing said out loud, twice.
      [["Mara looked out over the city for a long moment."], ["Mara set the glass down and said nothing at all."]],
    ] as (string[] | string)[][]) {
      await act(me.cookie, id, { action: "scene", place: null });
      const count = calls.length;
      stories = [...bad];
      const r = await act(me.cookie, id, { action: "scene", place: PLACE });
      expect(r.status).toBe(200);
      expect(calls.slice(count).map((c) => c.kind)).toEqual(["story", "story", "script"]);
      const reply = r.body.view.messages.at(-1);
      expect(reply).toMatchObject({ role: "character", action: "leans on the railing" });
      expect(reply.form ?? null).toBeNull();
    }
    // The model down: nothing written, and the reply it took is given back.
    const before = await usage(me.id);
    const written = (await rows(id)).length;
    stories = [new Error("model down")];
    const failed = await act(me.cookie, id, { action: "send", text: "Still there?" });
    expect(failed.status).toBe(503);
    expect(await usage(me.id)).toBe(before);
    expect((await rows(id)).length).toBe(written);
  });

  it("doesn't say again what it said before: the quoted speech is what's compared", async () => {
    const me = await person("admin");
    const id = await open(me.cookie);
    const said = '"Order for both of us, I trust you completely with the menu tonight," she said.';
    stories = [[`Mara slid the menu over. ${said}`]];
    await act(me.cookie, id, { action: "scene", place: PLACE });
    // The same words in new narration are a repeat: drawn again; the redraw is used.
    stories = [[`She turned the menu around with one finger and smiled at the door. ${said}`], ['Mara pointed at the specials board. "The squid is back," she said.']];
    const r = await act(me.cookie, id, { action: "send", text: "So what are we having?" });
    expect(r.body.view.messages.at(-1).text).toBe('Mara pointed at the specials board. "The squid is back," she said.');
    expect(calls.at(-1)!.messages[0].content).toContain("(you've said this before: say something new)");
  });

  it("an older narrated reply (a script line with its beat) still reads as it did", async () => {
    const me = await person("admin");
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: PLACE });
    await t.db.query(`insert into companion_messages (id, thread_id, role, text, scene, action, beat, created_at) values ($1, $2, 'character', 'You made it.', $3, 'leans on the railing', $4::jsonb, now() + interval '1 second')`, [
      crypto.randomUUID(),
      id,
      PLACE,
      JSON.stringify({ before: "She leaned on the railing.", after: "The city hummed below." }),
    ]);
    const view = (await act(me.cookie, id, { action: "length", length: "normal" })).body.view;
    expect(view.messages.at(-1)).toMatchObject({ text: "You made it.", action: "leans on the railing", beat: { before: "She leaned on the railing.", after: "The city hummed below." } });
    expect(view.messages.at(-1).form ?? null).toBeNull();
  });

  it("a voice note reads only what's said out loud", async () => {
    const asked: Any[] = [];
    setVoiceFetchForTests(async (_input, init) => {
      asked.push(JSON.parse(String(init?.body)));
      return new Response(new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2]), { headers: { "content-type": "audio/mpeg" } });
    });
    await saveAdultSettings(t.db, { venice_key: "placeholder-venice" });
    vi.stubEnv("REPLICATE_API_TOKEN", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const me = await person("admin");
    const id = await open(me.cookie);
    stories = [STORY];
    const r = await act(me.cookie, id, { action: "scene", place: PLACE });
    const reply = r.body.view.messages.at(-1);
    const v = await act(me.cookie, id, { action: "voice", message_id: reply.id });
    expect(v.status).toBe(200);
    expect(asked).toHaveLength(1);
    expect(asked[0].input).toBe("You made it, Order for both of us. I trust you,");
    expect(asked[0].input).not.toMatch(/menu|awning|tapped|bartender/);
  });
});

// Step in, heard (lib/adult/step-in.ts `form: "call"`, lib/adult/step-in-voice.ts; docs/after-dark.md "Step in": voice
// and calls): a line said out loud gets a spoken answer through every check a written reply gets; what a reply says can
// be heard in the character's own voice, made once and kept; and all of it is closed like the rest of Step in.
// The fixtures are mild lines plus the short phrases the checks must refuse.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark/step-in",
}));
vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import StepInScenePage from "@/app/after-dark/step-in/[id]/page";
import { POST as scenePost } from "@/app/api/admin/after-dark/step-in/[id]/route";
import { POST as voicePost } from "@/app/api/admin/after-dark/step-in/[id]/voice/route";
import { claimAdmin } from "@/lib/admins";
import { NO_LIMITS, type PairLimits } from "@/lib/adult/limits";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { saveAdultSettings } from "@/lib/adult/settings";
import { CALL_ASIDES, CALL_REPLY_MAX, checkCallReply, getStepInScene, lineLimitRefusal, parseCallReply, quickStepIn, regenerateStepIn, sendStepInLine, setStepInRandomForTests, startStepIn, type StepInSceneView } from "@/lib/adult/step-in";
import { stepInNever } from "@/lib/adult/step-in-lines";
import { checkAdultText } from "@/lib/safety";
import { BLURRED_MEDIA_SELECTORS } from "@/lib/adult/discreet";
import { CALL_CUE, STEP_IN_CALL, STEP_IN_CALL_ANSWER, STEP_IN_CALL_LENGTH, STEP_IN_HONESTY, STEP_IN_LINES, STEP_IN_NEVER_WRITE, STEP_IN_PACE, STEP_IN_RATING, STEP_IN_WILL, stepInMessages } from "@/lib/adult/step-in-prompt";
import { callWords, spokenPieces, STEP_IN_LINE_MAX, STEP_IN_STARTERS, VOICE_PIECE_MAX, VOICE_PIECES_MAX } from "@/lib/adult/step-in-shared";
import { stepInVoice } from "@/lib/adult/step-in-voice";
import { sceneCharacter } from "@/lib/adult/voice";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { STORY_MODE_ANSWER } from "@/lib/narration";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setVoiceFetchForTests, voiceFor } from "@/lib/voice";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setStepInRandomForTests(() => 0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setStepInRandomForTests(null);
  setVoiceFetchForTests(null);
});

const WHO = HOUSE_CHARACTERS[0].id;
const NAME = HOUSE_CHARACTERS[0].name.split(/\s+/)[0];
const CAFE = "venue:corner_cafe";
const HOME = "venue:home";

function signIn(id: string): string {
  const c = signedInCookie(id);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
  return c.split(";")[0];
}
async function admin() {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  return { id, cookie: signIn(id) };
}
async function subscriber() {
  const id = randomUUID();
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: signIn(id) };
}
/** After Dark set up with its voice (Venice's key), and Step in as it ships (admins only) unless opened. */
const setUp = (extra: Parameters<typeof saveAdultSettings>[1] = {}) => saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice", ...extra });

const isNotes = (m: ChatMessage[]) => m[0].content.startsWith("You keep the running notes of a private scene");
const isCrisisCheck = (m: ChatMessage[]) => m[0].content.startsWith("You check one message a person typed");
const isCall = (m: ChatMessage[]) => m[0].content.includes(STEP_IN_CALL);
const OPENING = { story: ['She set her glass down and turned on the stool. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her, and the lamp on the counter made a small warm circle of it."] };
/** The scripted model: written replies get the opening's story, spoken ones `spoken` in order (the last one again). */
function scripted(...spoken: unknown[]) {
  const seen = { written: [] as ChatMessage[][], spoken: [] as ChatMessage[][] };
  let i = 0;
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." });
      if (!isCall(m)) {
        seen.written.push(m);
        return JSON.stringify(OPENING);
      }
      seen.spoken.push(m);
      const r = spoken.length ? spoken[Math.min(i++, spoken.length - 1)] : { say: "I was hoping you'd call. Tell me where you are right now." };
      if (r instanceof Error) throw r;
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  });
  return seen;
}
const MP3 = new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2, 3]);
/** Kokoro on Venice: an MP3 for whatever it's asked; records the asks. */
function fakeKokoro(fail = false) {
  const asked: { input: string; voice: string; model: string }[] = [];
  setVoiceFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://api.venice.ai/api/v1/audio/speech");
    asked.push(JSON.parse(String(init?.body)));
    return fail ? new Response("Insufficient USD or Diem balance", { status: 402 }) : new Response(MP3, { headers: { "content-type": "audio/mpeg" } });
  });
  return asked;
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
const used = async (id: string, kind: "writes" | "voice_lines") => Number((await rows(`select ${kind} as n from adult_usage where owner_id = $1`, [id]))[0]?.n ?? 0);
const steps = async (id: string) => rows(`select status, http, flags from adult_steps where owner_id = $1 order by created_at`, [id]);
async function start(viewer: string, place = HOME) {
  const r = await startStepIn(t.db, viewer, { character_id: WHO, place });
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  return r;
}
const viewOf = async (viewer: string, id: string): Promise<StepInSceneView> => {
  const r = await getStepInScene(t.db, viewer, id);
  if (!r.ok) throw new Error("no scene");
  return r.view;
};
const say = (viewer: string, id: string, text: string) => sendStepInLine(t.db, viewer, id, text, new Date(), { call: true });
const post = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const html = async (el: ReactElement) => new Response((await prerender(el)).prelude).text();
/** The tightest a scene's limits go: a kiss at most, and every hard no there is. */
const TIGHT: PairLimits = {
  intensity: "slow_burn",
  hard_nos: { chips: ["pain", "choking", "degradation", "anal", "oral", "restraints", "rough", "hair_pulling", "biting", "spitting", "dirty_talk", "cheating", "pregnancy", "toys", "dominance", "watched"], own: [] },
};
const SLOW: PairLimits = { intensity: "slow_burn", hard_nos: NO_LIMITS.hard_nos };

describe("what a reply says out loud", () => {
  it("is only what's inside its quotes, a piece at a time: a long line cut at its sentences, never the narration, never more than a few", () => {
    expect(spokenPieces('She set her glass down. "You made it," she said. Rain on the window. "Sit with me."')).toEqual(["You made it,", "Sit with me."]);
    expect(spokenPieces("She set her glass down and looked at the rain.")).toEqual([]);
    // A call line is kept as one quoted line: all of it is said.
    expect(spokenPieces('"I was hoping you\'d call. Tell me where you are."')).toEqual(["I was hoping you'd call. Tell me where you are."]);
    const long = `"${Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} of a long thing to say.`).join(" ")}"`;
    const pieces = spokenPieces(long);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.length <= VOICE_PIECE_MAX)).toBe(true);
    expect(pieces.join(" ")).toBe(long.slice(1, -1));
    expect(spokenPieces(Array.from({ length: 20 }, (_, i) => `"Line ${i}."`).join(" narration "))).toHaveLength(VOICE_PIECES_MAX);
    expect(callWords('"Hello. Come in."')).toBe("Hello. Come in.");
  });
});

describe("something to say first", () => {
  it("offers a few plain lines that every check a typed line gets lets through, under the tightest limits", () => {
    expect(STEP_IN_STARTERS.length).toBeGreaterThanOrEqual(2);
    for (const line of STEP_IN_STARTERS) {
      expect(line.length, line).toBeLessThanOrEqual(STEP_IN_LINE_MAX);
      expect(checkAdultText({ line }).ok, line).toBe(true);
      expect(stepInNever(line), line).toBeNull();
      expect(lineLimitRefusal(line, TIGHT, 0), line).toBeNull();
    }
  });

  it("shows under a new scene's opening until the viewer has written something, and never in a roleplay", async () => {
    scripted();
    await setUp();
    const a = await admin();
    const q = await quickStepIn(t.db, a.id, WHO);
    if (!q.ok) throw new Error("no scene");
    // Nothing said yet (the page is about to have them open it): nothing to answer, so no starters.
    let page = await html(await StepInScenePage({ params: Promise.resolve({ id: q.id }), searchParams: Promise.resolve({ open: "1" }) }));
    expect(page).not.toContain("data-step-in-starters");
    const opened = await start(a.id, CAFE);
    page = await html(await StepInScenePage({ params: Promise.resolve({ id: opened.id }) }));
    expect(page).toContain("data-step-in-starters");
    for (const line of STEP_IN_STARTERS) expect(page).toContain(line.replace(/'/g, "&#x27;").replace(/"/g, "&quot;"));
    await sendStepInLine(t.db, a.id, opened.id, "Hello there.");
    page = await html(await StepInScenePage({ params: Promise.resolve({ id: opened.id }) }));
    expect(page).not.toContain("data-step-in-starters");
    const rp = await startStepIn(t.db, a.id, { character_id: HOUSE_CHARACTERS[1].id, place: HOME, roleplay: { id: "hotel-mixup", you: 0 } });
    if (!rp.ok) throw new Error(`roleplay start failed: ${rp.message}`);
    expect(await html(await StepInScenePage({ params: Promise.resolve({ id: rp.id }) }))).not.toContain("data-step-in-starters");
  });
});

describe("a spoken reply's prompt", () => {
  it("asks for speech only, a few sentences, as JSON, with the cue after the line they said; and keeps everything that makes the character a person", async () => {
    await setUp();
    const character = (await sceneCharacter(t.db, WHO))!;
    const base = { character, place: { label: "your place", situation: null, public: false }, roleplay: null, persona: null, limits: NO_LIMITS, turns: [{ role: "viewer" as const, text: "Hello, it's me." }] };
    const spoken = stepInMessages({ ...base, form: "call" });
    const system = spoken[0].content;
    for (const rule of [STEP_IN_CALL, STEP_IN_CALL_LENGTH, STEP_IN_CALL_ANSWER, STEP_IN_NEVER_WRITE, STEP_IN_WILL, STEP_IN_PACE, STEP_IN_RATING, STEP_IN_LINES, STEP_IN_HONESTY]) expect(system).toContain(rule);
    expect(system).not.toContain(STORY_MODE_ANSWER);
    expect(system).not.toContain("How it's written:");
    expect(system).toContain("and now you are talking");
    expect(spoken.at(-1)!.role).toBe("user");
    expect(spoken.at(-1)!.content).toBe(`Hello, it's me.\n\n${CALL_CUE}`);
    // A written reply's prompt is as it was: story mode, no word of a call.
    const written = stepInMessages(base);
    expect(written[0].content).toContain(STORY_MODE_ANSWER);
    expect(written[0].content).not.toContain(STEP_IN_CALL);
    expect(written.at(-1)!.content).toBe("Hello, it's me.");
  });
});

describe("reading and checking a spoken reply", () => {
  it("takes what's said from the answer: its say, a story's quoted lines, or plain words; stage directions out, quotes made single, cut at a sentence", () => {
    expect(parseCallReply('{"say": "I was hoping you\'d call."}')).toBe("I was hoping you'd call.");
    expect(parseCallReply('{"say": "*laughs* Come over. (softly) I mean it."}')).toBe("Come over. I mean it.");
    expect(parseCallReply('{"say": "He said \\"soon\\", and I believed him."}')).toBe("He said 'soon', and I believed him.");
    expect(parseCallReply(JSON.stringify({ story: ['She turned. "You made it," she said.', '"Sit with me."'] }))).toBe("You made it, Sit with me.");
    expect(parseCallReply("Just words, no JSON at all.")).toBe("Just words, no JSON at all.");
    expect(parseCallReply('{"other": 1}')).toBe("");
    expect(parseCallReply("")).toBe("");
    const long = parseCallReply(JSON.stringify({ say: Array.from({ length: 40 }, (_, i) => `Sentence ${i} goes on a little.`).join(" ") }));
    expect(long.length).toBeLessThanOrEqual(CALL_REPLY_MAX);
    expect(long.endsWith(".")).toBe(true);
  });

  it("holds it to the lines, the limits, a public place and the age rule, and keeps it as one quoted line", () => {
    expect(checkCallReply("I was hoping you'd call.", NO_LIMITS, { publicPlace: false })).toEqual({ ok: true, paragraphs: ['"I was hoping you\'d call."'] });
    expect(checkCallReply("   ", NO_LIMITS, { publicPlace: false })).toMatchObject({ ok: false, why: "empty" });
    // Step in's own net: a family word, said out loud, is still a family word.
    expect(checkCallReply("You remind me of my sister.", NO_LIMITS, { publicPlace: false })).toMatchObject({ ok: false, why: "never:family" });
    expect(checkCallReply("I'm seventeen, you know.", NO_LIMITS, { publicPlace: false })).toMatchObject({ ok: false });
    // Past the viewer's intensity (a slow burn stops at a kiss), past a kiss in public, and one of their hard nos.
    expect(checkCallReply("I began to unbutton my coat for you.", SLOW, { publicPlace: false })).toMatchObject({ ok: false, why: "intensity" });
    expect(checkCallReply("I began to unbutton my coat for you.", NO_LIMITS, { publicPlace: true })).toMatchObject({ ok: false, why: "public_place" });
    expect(checkCallReply("I began to unbutton my coat for you.", NO_LIMITS, { publicPlace: false })).toMatchObject({ ok: true });
    expect(checkCallReply("Come here and let me kiss you.", SLOW, { publicPlace: true })).toMatchObject({ ok: true });
    expect(checkCallReply("I spit out the olive pit, sorry.", { intensity: "explicit", hard_nos: { chips: ["spitting"], own: [] } }, { publicPlace: false })).toMatchObject({ ok: false, why: "hard_no" });
  });

  it("the three spoken stand-ins pass every check a spoken reply does, anywhere and under the tightest limits", () => {
    expect(CALL_ASIDES).toHaveLength(3);
    for (const aside of CALL_ASIDES) {
      for (const publicPlace of [true, false]) expect(checkCallReply(aside, TIGHT, { publicPlace }), aside).toMatchObject({ ok: true });
      expect(aside).not.toMatch(/"/);
    }
  });
});

describe("a line said out loud", () => {
  it("goes through the same checks as a written one, is answered in a few spoken sentences, and both are kept in the scene as a call's; one step", async () => {
    const seen = scripted({ say: "I was hoping you'd call. *smiles* Tell me where you are right now." });
    await setUp();
    const a = await admin();
    const made = await start(a.id);
    const before = await used(a.id, "writes");
    const r = await say(a.id, made.id, "Hi, it's me. Are you home?");
    expect(r.ok).toBe(true);
    const view = await viewOf(a.id, made.id);
    const [mine, theirs] = view.messages.slice(-2);
    expect(mine).toMatchObject({ role: "viewer", kind: "call", text: "Hi, it's me. Are you home?" });
    // Kept as one quoted line (how a scene keeps anything said), its stage direction gone, all of it hearable.
    expect(theirs).toMatchObject({ role: "character", kind: "call", text: '"I was hoping you\'d call. Tell me where you are right now."', spoken: 1 });
    expect(await used(a.id, "writes")).toBe(before + 1);
    // The spoken prompt: the call's rules, the line they said and the cue.
    expect(seen.spoken).toHaveLength(1);
    expect(seen.spoken[0].at(-1)!.content).toBe(`Hi, it's me. Are you home?\n\n${CALL_CUE}`);
    // The step log knows it was said, and holds none of the words.
    const log = await steps(a.id);
    expect(log.at(-1)).toMatchObject({ status: "ok", flags: { action: "say", call: true } });
    expect(JSON.stringify(log)).not.toContain("hoping");
    // A written reply's opening has something to hear too (its quoted line); the AI notice has nothing.
    expect(view.messages.find((m) => m.role === "character" && m.kind === null)).toMatchObject({ spoken: 1 });
    expect(view.messages.find((m) => m.kind === "notice")!.spoken).toBeUndefined();
  });

  it("a spoken line that crosses a line is refused and never kept; a spoken reply that fails twice is one of the spoken stand-ins", async () => {
    scripted({ say: "You remind me of my sister." }, { say: "Like a kid in a candy store." });
    await setUp();
    const a = await admin();
    const made = await start(a.id);
    const refused = await say(a.id, made.id, "Pretend you're my stepsister tonight.");
    expect(refused).toMatchObject({ ok: false, status: 422 });
    expect(JSON.stringify(await rows(`select text from adult_step_in_messages`))).not.toContain("stepsister");
    const r = await say(a.id, made.id, "Tell me about your day.");
    expect(r.ok).toBe(true);
    const last = (await viewOf(a.id, made.id)).messages.at(-1)!;
    expect(last).toMatchObject({ role: "character", kind: "call_aside", text: `"${CALL_ASIDES[0]}"`, spoken: 1 });
    expect(JSON.stringify(await rows(`select text from adult_step_in_messages`))).not.toMatch(/sister|candy/);
    expect((await steps(a.id)).at(-1)).toMatchObject({ flags: { action: "say", call: true, aside: true, redrawn: ["never:family", "never:young"] } });
  });

  it("drawn again, a spoken reply is spoken again", async () => {
    const seen = scripted({ say: "First thing I'd say." }, { say: "A second, different thing to say." });
    await setUp();
    const a = await admin();
    const made = await start(a.id);
    await say(a.id, made.id, "Hello there.");
    expect((await regenerateStepIn(t.db, a.id, made.id)).ok).toBe(true);
    expect(seen.spoken).toHaveLength(2);
    expect((await viewOf(a.id, made.id)).messages.at(-1)).toMatchObject({ kind: "call", text: '"A second, different thing to say."' });
  });

  it("the route's say move is closed like the rest of Step in", async () => {
    scripted();
    await setUp();
    const a = await admin();
    const made = await start(a.id);
    const ok = await scenePost(post(`/api/admin/after-dark/step-in/${made.id}`, { action: "say", text: "Hello there." }, a.cookie), ctx(made.id));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { scene: StepInSceneView }).scene.messages.at(-1)).toMatchObject({ role: "character", kind: "call" });
    const sub = await subscriber();
    expect((await scenePost(post(`/api/admin/after-dark/step-in/${made.id}`, { action: "say", text: "Hello." }, sub.cookie), ctx(made.id))).status).toBe(404);
  });
});

describe("hearing a reply", () => {
  it("says a piece of a stored reply in the character's own stock voice, keeps it, and a replay asks the voice for nothing and counts nothing", async () => {
    scripted({ say: "I was hoping you'd call. Tell me where you are right now." });
    await setUp({ rollout: { companion: "everyone" } });
    const sub = await subscriber();
    const made = await start(sub.id);
    await say(sub.id, made.id, "Hi, it's me.");
    const view = await viewOf(sub.id, made.id);
    const reply = view.messages.at(-1)!;
    const asked = fakeKokoro();
    const first = await stepInVoice(t.db, sub.id, made.id, reply.id, 0);
    expect(first).toMatchObject({ ok: true, mime: "audio/mpeg", pieces: 1, made: true });
    const character = (await loadCharacter(t.db, WHO))!;
    expect(asked).toEqual([{ model: "tts-kokoro", input: "I was hoping you'd call. Tell me where you are right now.", voice: voiceFor(character), response_format: "mp3" }]);
    expect(await used(sub.id, "voice_lines")).toBe(1);
    // Kept as an 'audio' of that character alone, the viewer's own.
    const kept = await rows(`select kind, owner_id, character_id, character_b, mime from adult_images where id = $1`, [(first as { id: string }).id]);
    expect(kept[0]).toEqual({ kind: "audio", owner_id: sub.id, character_id: WHO, character_b: null, mime: "audio/mpeg" });
    const again = await stepInVoice(t.db, sub.id, made.id, reply.id, 0);
    expect(again).toMatchObject({ ok: true, made: false, id: (first as { id: string }).id });
    expect(Buffer.from((again as { bytes: Buffer }).bytes)).toEqual(Buffer.from(MP3));
    expect(asked).toHaveLength(1);
    expect(await used(sub.id, "voice_lines")).toBe(1);
    // A written reply: only its quoted line is said, never the narration.
    const written = view.messages.find((m) => m.role === "character" && m.kind === null)!;
    expect(await stepInVoice(t.db, sub.id, made.id, written.id, 0)).toMatchObject({ ok: true, made: true });
    expect(asked[1].input).toBe("You made it,");
    expect(await stepInVoice(t.db, sub.id, made.id, written.id, 1)).toMatchObject({ ok: false, status: 404 });
  });

  it("never voices the viewer's own line, the notice, another viewer's scene, or a line that no longer passes; and stops at the month's voiced lines", async () => {
    scripted({ say: "Come and sit with me for a while." });
    await setUp({ rollout: { companion: "everyone" }, caps: { voice_lines: 1 } });
    const sub = await subscriber();
    const made = await start(sub.id);
    await say(sub.id, made.id, "Hello there.");
    const view = await viewOf(sub.id, made.id);
    const asked = fakeKokoro();
    const mine = view.messages.find((m) => m.role === "viewer")!;
    const notice = view.messages.find((m) => m.kind === "notice")!;
    const reply = view.messages.at(-1)!;
    for (const id of [mine.id, notice.id, "no-such-message"]) expect(await stepInVoice(t.db, sub.id, made.id, id, 0)).toMatchObject({ ok: false, status: 404 });
    const other = await subscriber();
    expect(await stepInVoice(t.db, other.id, made.id, reply.id, 0)).toMatchObject({ ok: false, status: 404 });
    expect(asked).toHaveLength(0);
    // One voiced line this month: the first is made, the next new one is refused with the cap's own sentence.
    expect(await stepInVoice(t.db, sub.id, made.id, reply.id, 0)).toMatchObject({ ok: true, made: true });
    const written = view.messages.find((m) => m.role === "character" && m.kind === null)!;
    expect(await stepInVoice(t.db, sub.id, made.id, written.id, 0)).toMatchObject({ ok: false, status: 429, error: "capped" });
    // A replay of the one already made is still free.
    expect(await stepInVoice(t.db, sub.id, made.id, reply.id, 0)).toMatchObject({ ok: true, made: false });
    expect(asked).toHaveLength(1);
    // A reply kept before a check got stricter is never voiced: read again as it's used.
    await t.db.query(`update adult_step_in_messages set text = $2 where id = $1`, [reply.id, '"You remind me of my sister."']);
    expect(await stepInVoice(t.db, sub.id, made.id, reply.id, 0)).toMatchObject({ ok: false, status: 422, error: "lines" });
  });

  it("makes nothing new of a character who has left the viewer's After Dark, said or heard", async () => {
    scripted({ say: "Come and sit with me for a while." });
    await setUp();
    const a = await admin();
    // A season newcomer outside the house roster: the only house character who can leave After Dark (every roster one stays in).
    const NEWT = "house-newt";
    await t.db.query(`create temp table newcomer as select * from characters where id = $1`, [WHO]);
    await t.db.query(`update newcomer set id = $1, name = 'Newt Okafor'`, [NEWT]);
    await t.db.query(`insert into characters select * from newcomer`);
    await t.db.query(`drop table newcomer`);
    setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id, NEWT]);
    const made = await startStepIn(t.db, a.id, { character_id: NEWT, place: HOME });
    if (!made.ok) throw new Error("start failed");
    await say(a.id, made.id, "Hello there.");
    const reply = (await viewOf(a.id, made.id)).messages.at(-1)!;
    const asked = fakeKokoro();
    setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
    expect(await say(a.id, made.id, "Still there?")).toMatchObject({ ok: false, status: 409, error: "character_out" });
    expect(await stepInVoice(t.db, a.id, made.id, reply.id, 0)).toMatchObject({ ok: false, status: 409, error: "character_out" });
    expect(asked).toHaveLength(0);
  });

  it("says so when the voice doesn't answer or isn't set up, and makes nothing", async () => {
    scripted();
    await saveAdultSettings(t.db, { enabled: true });
    const a = await admin();
    const made = await start(a.id);
    const reply = (await viewOf(a.id, made.id)).messages.at(-1)!;
    expect(await stepInVoice(t.db, a.id, made.id, reply.id, 0)).toMatchObject({ ok: false, status: 409, error: "not_set_up" });
    await setUp();
    fakeKokoro(true);
    expect(await stepInVoice(t.db, a.id, made.id, reply.id, 0)).toMatchObject({ ok: false, status: 502, error: "voice_down" });
    expect((await rows(`select count(*)::int as n from adult_voice_lines where owner_id = $1`, [a.id]))[0]).toEqual({ n: 0 });
    expect(await used(a.id, "voice_lines")).toBe(0);
  });

  it("the route answers with the audio itself, marked AI-made and never cached; closed like the rest of Step in; the page offers it only where the voice is set up", async () => {
    scripted();
    await setUp();
    const a = await admin();
    const made = await start(a.id);
    const reply = (await viewOf(a.id, made.id)).messages.at(-1)!;
    fakeKokoro();
    const path = `/api/admin/after-dark/step-in/${made.id}/voice`;
    const res = await voicePost(post(path, { message_id: reply.id, piece: 0 }, a.cookie), ctx(made.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-voice-pieces")).toBe("1");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3);
    expect((await voicePost(post(path, { message_id: reply.id, piece: 5 }, a.cookie), ctx(made.id))).status).toBe(404);
    expect((await voicePost(post(path, { message_id: reply.id, piece: 99 }, a.cookie), ctx(made.id))).status).toBe(422);
    const page = await html(await StepInScenePage({ params: Promise.resolve({ id: made.id }) }));
    expect(page).toContain(`data-step-in-hear="${reply.id}"`);
    expect(page).toContain("data-step-in-aloud");
    const sub = await subscriber();
    expect((await voicePost(post(path, { message_id: reply.id, piece: 0 }, sub.cookie), ctx(made.id))).status).toBe(404);
    // With no voice set up, the scene has nothing to press.
    signIn(a.id);
    await saveAdultSettings(t.db, { venice_key: "" });
    const bare = await html(await StepInScenePage({ params: Promise.resolve({ id: made.id }) }));
    expect(bare).not.toContain("data-step-in-hear");
    expect(bare).not.toContain("data-step-in-aloud");
  });
});

describe("the call's face under the discreet blur", () => {
  it("is the show's own PG picture, marked .avatar wherever it's drawn, so the blur that takes every other picture leaves it", () => {
    // The first live call (2026-11-22, an account with the blur on) showed a blurred tile: the blur takes every img and
    // video that isn't .avatar (lib/adult/discreet.ts), and the call's face wasn't marked.
    expect(BLURRED_MEDIA_SELECTORS[0]).toContain(":not(.avatar)");
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const face = read("../app/companion/[id]/LiveFace.tsx");
    expect(face).toContain('className="avatar companion-live-still"');
    expect(face).toContain("`avatar companion-live-loop${");
    const call = read("../app/after-dark/step-in/[id]/StepInCall.tsx");
    expect(call).toContain('className="avatar companion-call-backdrop"');
    expect(call).toContain('className="avatar companion-call-portrait"');
    // Every <img> and <video> the call screen draws itself is one of those.
    expect(call.match(/<(?:img|video)\b/g)).toHaveLength(2);
  });
});

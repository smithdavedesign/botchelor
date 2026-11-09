import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import type { Character } from "@/lib/character";
import { setCompanionModelForTests } from "@/lib/companion";
import { companionMessages, type PromptTurn } from "@/lib/companion-prompt";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage, ModelOptions } from "@/lib/model";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
const PLACE = "rooftop_bar";

/** The reply calls the model got, with their options; it answers in two messages unless a test says otherwise. */
let calls: { messages: ChatMessage[]; options?: ModelOptions }[] = [];
let logs: Record<string, unknown>[] = [];

beforeEach(async () => {
  await t.reset();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    try {
      if (typeof line === "string" && line.startsWith("{")) logs.push(JSON.parse(line));
    } catch {
      // Not an analytics line.
    }
  });
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  calls = [];
  let n = 0;
  setCompanionModelForTests({
    async complete(messages, options) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (!system.startsWith("You are ")) return "{}";
      calls.push({ messages, options });
      if (system.includes("playing a scene together")) return JSON.stringify({ say: `Scene line ${++n}.`, do: "leans on the railing" });
      return JSON.stringify({ messages: [`Oh, hi! Reply ${++n}.`, "Tell me about your day."] });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const person = async () => {
  const id = crypto.randomUUID();
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const req = (path: string, body: unknown, cookie: string) => new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function open(cookie: string): Promise<string> {
  return ((await (await openRoute(req("/api/companion", { character_id: CAST.id }, cookie))).json()) as Any).thread_id;
}
async function act(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
}
const usage = async (userId: string) => (await t.db.query<{ replies: number }>(`select replies from companion_usage where user_id = $1`, [userId])).rows[0]?.replies ?? 0;
const tracked = (event: string) => logs.filter((l) => l.log === "analytics" && l.event === event);

/** A character as loadCharacter returns it, with only what the prompt reads filled in. */
function character(): Character {
  return {
    id: "c1",
    name: "Nell Okafor",
    age: 31,
    bio: "A ferry pilot who collects bad postcards.",
    house: true,
    ownerId: null,
    look: { appearance: null, hue: null, portrait: null },
    persona: { traits: ["dry", "warm"], want: "Someone who laughs first" },
    pronouns: "she/her",
    voice: "Short sentences, deadpan.",
    dealbreaker: "Rudeness to waiters",
    soul: null,
    baseSignals: {} as Character["baseSignals"],
    signals: {} as Character["signals"],
    memory: null,
    record: {} as Character["record"],
    extras: {} as Character["extras"],
    thisWeek: null,
  } as Character;
}
const base = { turns: [{ role: "user", text: "hey, can you hear me?" }] as PromptTurn[], facts: [], summary: null, length: "normal" as const, avoid: [], now: new Date("2026-11-09T12:00:00Z") };

describe("a call's prompt", () => {
  it("is out loud and short, in one string, and honest that the call's in the app and the voice is made", () => {
    const call = companionMessages({ ...base, character: character(), call: true })[0].content;
    expect(call).toContain("right now you're on a voice call with them in the app");
    expect(call).toContain("How you talk: out loud, on a call.");
    expect(call).toContain("one to three sentences, then let them talk");
    expect(call).toContain("no emoji");
    expect(call).toContain('{"messages":["what you say"]}, one string');
    expect(call).toContain("your voice is generated: you're still an AI character on it");
    expect(call).toContain("to be able to meet or do things in the real world");
    expect(call).not.toContain("like texting");
    // Texting stays as it was: a call there is still something they can't do.
    const text = companionMessages({ ...base, character: character() })[0].content;
    expect(text).toContain("you're texting with them.");
    expect(text).toContain("to be able to meet, call or do things in the real world");
    expect(text).not.toContain("voice call");
  });

  it("gives way to a scene: face to face there, never on a call", () => {
    const m = companionMessages({ ...base, character: character(), call: true, scene: { name: "Nell", prompt: "a rooftop bar at golden hour" } })[0].content;
    expect(m).toContain("playing a scene together");
    expect(m).not.toContain("voice call");
    expect(m).toContain("to be able to meet, call or do things");
  });
});

describe("a call", () => {
  it("says a line like a message: one reply counted, one spoken answer, both marked as said on the call", async () => {
    const me = await person();
    const id = await open(me.cookie);
    const before = await usage(me.id);
    const r = await act(me.cookie, id, { action: "send", text: "hi, it's me on the phone", call: true });
    expect(r.status).toBe(200);
    expect(await usage(me.id)).toBe(before + 1);
    const ms = r.body.view.messages;
    const mine = ms.findLast((m: Any) => m.role === "user");
    expect(mine).toMatchObject({ text: "hi, it's me on the phone", call: true });
    // The model's two messages are said in one go.
    const reply = ms.slice(ms.indexOf(mine) + 1);
    expect(reply).toHaveLength(1);
    expect(reply[0]).toMatchObject({ role: "character", call: true });
    expect(reply[0].text).toMatch(/^Oh, hi! Reply \d+\. Tell me about your day\.$/);
    // Asked out loud and short.
    const last = calls.at(-1)!;
    expect(last.messages[0].content).toContain("on a voice call with them");
    expect(last.options?.maxTokens).toBe(250);
    expect(tracked("companion_reply").at(-1)).toMatchObject({ call: true, bubbles: 1 });
    const stored = await t.db.query<{ on_call: boolean }>(`select on_call from companion_messages where thread_id = $1 and role <> 'system' order by created_at, id`, [id]);
    // The opener's two messages were texted; the line and its answer were said on the call.
    expect(stored.rows.map((r) => r.on_call)).toEqual([false, false, true, true]);
  });

  it("leaves texting as it was: no marks, the texting prompt, the messages apart", async () => {
    const me = await person();
    const id = await open(me.cookie);
    const r = await act(me.cookie, id, { action: "send", text: "typed this one" });
    expect(r.status).toBe(200);
    const ms = r.body.view.messages;
    const mine = ms.findLast((m: Any) => m.role === "user");
    expect(mine.call).toBeUndefined();
    const reply = ms.slice(ms.indexOf(mine) + 1);
    expect(reply).toHaveLength(2);
    expect(reply.every((m: Any) => m.call === undefined)).toBe(true);
    expect(calls.at(-1)!.messages[0].content).toContain("you're texting with them.");
    expect(calls.at(-1)!.options?.maxTokens).toBe(400);
  });

  it("is an ordinary line in a scene (the app offers no call there)", async () => {
    const me = await person();
    const id = await open(me.cookie);
    expect((await act(me.cookie, id, { action: "scene", place: PLACE })).status).toBe(200);
    const r = await act(me.cookie, id, { action: "send", text: "this view though", call: true });
    expect(r.status).toBe(200);
    const said = r.body.view.messages.slice(-2);
    expect(said.map((m: Any) => m.role)).toEqual(["user", "character"]);
    expect(said.every((m: Any) => m.call === undefined && m.scene === PLACE)).toBe(true);
    expect(calls.at(-1)!.messages[0].content).not.toContain("voice call");
  });

  it("counts its start and end (how long, how many turns, which voice), never a reply, and only on your own thread", async () => {
    const me = await person();
    const id = await open(me.cookie);
    const before = await usage(me.id);
    expect((await act(me.cookie, id, { action: "call", event: "start", voice: "device" })).body).toEqual({ ok: true });
    expect((await act(me.cookie, id, { action: "call", event: "end", seconds: 95, turns: 6, voice: "own" })).status).toBe(200);
    expect(await usage(me.id)).toBe(before);
    expect(tracked("companion_call").map(({ stage, seconds, turns, voice }) => ({ stage, seconds, turns, voice }))).toEqual([
      { stage: "start", seconds: undefined, turns: undefined, voice: "device" },
      { stage: "end", seconds: 95, turns: 6, voice: "own" },
    ]);
    const someone = await person();
    expect((await act(someone.cookie, id, { action: "call", event: "start" })).status).toBe(404);
    expect((await act(me.cookie, id, { action: "call", event: "ring" })).status).toBe(422);
  });
});

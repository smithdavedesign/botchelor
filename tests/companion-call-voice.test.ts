import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import { POST as speakRoute } from "@/app/api/companion/[id]/speak/route";
import { voiceFor } from "@/app/stage/useSpeech";
import { signSession } from "@/lib/auth";
import { setCompanionModelForTests } from "@/lib/companion";
import { CALL_VOICE_ALL, CALL_VOICE_PER_REPLY, callVoiceOn } from "@/lib/companion-call-voice";
import { auraVoiceFor, setDeepgramFetchForTests } from "@/lib/companion-live";
import { COMPANION_GUEST_IP_LIMITS } from "@/lib/companion";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { visitorKey } from "@/lib/limits";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A stand-in server key, never a real one: built from parts so no scanner mistakes it for a secret. */
const FAKE_KEY = ["dg", "test", "not", "a", "key"].join("-");
/** Aura's WAV, faked: a header's worth of bytes and a few samples. */
const WAV = new Uint8Array([...new TextEncoder().encode("RIFF"), ...new Array(52).fill(1)]);
const CAST = HOUSE_CHARACTERS[0];
const REPLY = "So good to hear your voice. *grins* How was the ferry?";

describe("the switch", () => {
  it("is on with the Deepgram key, for everyone, unless COMPANION_LIVE is 0 or off", () => {
    expect(callVoiceOn({})).toBe(false);
    expect(callVoiceOn({ DEEPGRAM_API_KEY: " " })).toBe(false);
    expect(callVoiceOn({ DEEPGRAM_API_KEY: FAKE_KEY })).toBe(true);
    expect(callVoiceOn({ DEEPGRAM_API_KEY: FAKE_KEY, COMPANION_LIVE: "0" })).toBe(false);
    expect(callVoiceOn({ DEEPGRAM_API_KEY: FAKE_KEY, COMPANION_LIVE: "Off" })).toBe(false);
    // Live calls for admins only still leaves everyone's taking-turns voice on.
    expect(callVoiceOn({ DEEPGRAM_API_KEY: FAKE_KEY, COMPANION_LIVE: "admins" })).toBe(true);
  });
});

describe("the device's voice, when it's the device's", () => {
  const v = (name: string) => ({ name, lang: "en-US" }) as SpeechSynthesisVoice;
  const voices = [v("Fred"), v("Samantha"), v("Daniel"), v("Microsoft Aria Online (Natural) - English (United States)"), v("Google UK English Male"), v("Albert")];

  it("picks a natural voice that fits their pronouns before a default one", () => {
    expect(voiceFor(voices, { id: "a", pronouns: "she/her" })?.name).toMatch(/Aria Online \(Natural\)/);
    expect(voiceFor(voices, { id: "a", pronouns: "he/him" })?.name).toBe("Google UK English Male");
  });

  it("keeps to their pronouns over a natural voice that doesn't fit", () => {
    const plain = [v("Fred"), v("Daniel"), v("Samantha (Enhanced)")];
    expect(["Fred", "Daniel"]).toContain(voiceFor(plain, { id: "b", pronouns: "he/him" })?.name);
  });

  it("with no pronouns, takes the most natural there is, the same one every time", () => {
    const one = voiceFor(voices, { id: "c", pronouns: "they/them" });
    expect(one?.name).toMatch(/Natural/);
    expect(voiceFor(voices, { id: "c", pronouns: "they/them" })).toBe(one);
    expect(voiceFor([v("Fred"), v("Albert")], { id: "c" })?.name).toMatch(/Fred|Albert/);
    expect(voiceFor([], { id: "c" })).toBeNull();
  });
});

/* ------------------------------------------------- with a database ------------------------------------------------- */

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

let deepgram: { url: string; body: Any }[] = [];
let auraDown = false;
let logged: string[] = [];

beforeEach(async () => {
  await t.reset();
  logged = [];
  for (const level of ["log", "error", "warn"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.stubEnv("DEEPGRAM_API_KEY", FAKE_KEY);
  vi.stubEnv("COMPANION_LIVE", "");
  deepgram = [];
  auraDown = false;
  setDeepgramFetchForTests(async (input, init) => {
    const url = String(input);
    deepgram.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/v1/speak?")) return auraDown ? new Response("down", { status: 500 }) : new Response(WAV);
    return new Response("unexpected", { status: 404 });
  });
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (system.startsWith("You are ")) return JSON.stringify({ messages: [REPLY] });
      return "{}";
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setDeepgramFetchForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const FROM = "203.0.113.40";
const req = (path: string, body: unknown, cookie: string) =>
  new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": FROM, cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const member = () => ({ cookie: `${signedInCookie(crypto.randomUUID())}; bz_adult=1` });
const guest = () => ({ cookie: `bz_sess=${signSession({ uid: crypto.randomUUID(), authenticated: false })}; bz_adult=1` });

async function thread(cookie: string): Promise<string> {
  const res = await openRoute(req("/api/companion", { character_id: CAST.id }, cookie));
  expect(res.status).toBeLessThan(300);
  return ((await res.json()) as Any).thread_id as string;
}
/** Says something (on a call, or typed) and returns the ids of the reply's messages. */
async function said(cookie: string, id: string, call: boolean): Promise<string[]> {
  const res = await actRoute(req(`/api/companion/${id}`, { action: "send", text: "hi there", call }, cookie), ctx(id));
  expect(res.status).toBe(200);
  const ms = ((await res.json()) as Any).view.messages as { id: string; role: string }[];
  return ms.slice(ms.findLastIndex((m) => m.role === "user") + 1).map((m) => m.id);
}
const speak = async (cookie: string, id: string, ids: string[]) => {
  const res = await speakRoute(req(`/api/companion/${id}/speak`, { message_ids: ids }, cookie), ctx(id));
  return { status: res.status, type: res.headers.get("content-type") ?? "", res };
};

describe("a taking-turns call's reply in their own voice", () => {
  it("says a guest's call reply in the character's Aura voice, from the stored words only", async () => {
    const g = guest();
    const id = await thread(g.cookie);
    const ids = await said(g.cookie, id, true);
    const r = await speak(g.cookie, id, ids);
    expect(r.status).toBe(200);
    expect(r.type).toBe("audio/wav");
    expect(new Uint8Array(await r.res.arrayBuffer())).toEqual(WAV);
    expect(deepgram).toHaveLength(1);
    const url = new URL(deepgram[0].url);
    expect(url.searchParams.get("model")).toBe(auraVoiceFor(CAST));
    expect(url.searchParams.get("container")).toBe("wav");
    expect(url.searchParams.get("mip_opt_out")).toBe("true");
    // What's said is the kept reply, made sayable: no *action*.
    expect(deepgram[0].body.text).toBe("So good to hear your voice. How was the ferry?");
    // Counted for /admin (the characters voiced), never the words or the audio.
    const counted = logged.find((l) => l.includes('"companion_call"') && l.includes('"voice"'));
    expect(counted).toBeDefined();
    expect(JSON.parse(counted!)).toMatchObject({ stage: "voice", aura_chars: deepgram[0].body.text.length, guest: true });
    expect(logged.join("\n")).not.toContain("ferry");
  });

  it("voices only a reply said on a call", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const typed = await said(me.cookie, id, false);
    const r = await speak(me.cookie, id, typed);
    expect(r.status).toBe(409);
    expect(((await r.res.json()) as Any).error).toBe("not_on_call");
    expect(deepgram).toEqual([]);
  });

  it("voices only the character's replies in this person's own thread", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const ids = await said(me.cookie, id, true);
    // Someone else, with the thread's id and the reply's: not found.
    const other = member();
    expect((await speak(other.cookie, id, ids)).status).toBe(404);
    const theirs = await thread(other.cookie);
    expect((await speak(other.cookie, theirs, ids)).status).toBe(404);
    // Their own line isn't the character's.
    const mine = (await t.db.query<{ id: string }>(`select id from companion_messages where thread_id = $1 and role = 'user'`, [id])).rows.map((m) => m.id);
    expect((await speak(me.cookie, id, mine)).status).toBe(404);
    expect(deepgram).toEqual([]);
  });

  it("says each reply at most twice", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const ids = await said(me.cookie, id, true);
    for (let i = 0; i < CALL_VOICE_PER_REPLY.perDay; i++) expect((await speak(me.cookie, id, ids)).status).toBe(200);
    const again = await speak(me.cookie, id, ids);
    expect(again.status).toBe(429);
    expect(((await again.res.json()) as Any).error).toBe("said");
    expect(deepgram).toHaveLength(CALL_VOICE_PER_REPLY.perDay);
  });

  it("holds a guest's address to the guests' limit, and everyone together to a day's cap", async () => {
    const g = guest();
    const id = await thread(g.cookie);
    const ids = await said(g.cookie, id, true);
    const key = visitorKey(new Headers({ "x-forwarded-for": FROM }))!;
    for (let i = 0; i < COMPANION_GUEST_IP_LIMITS.perHour; i++) await t.db.query(`insert into rate_hits (bucket, key, at) values ('companion_call_voice_guest', $1, now())`, [key]);
    expect((await speak(g.cookie, id, ids)).status).toBe(429);
    // An account isn't held by the guests' address limit, but everyone is by the day's cap (and it falls back).
    const me = member();
    const mine = await thread(me.cookie);
    const replies = await said(me.cookie, mine, true);
    await t.db.query(`insert into rate_hits (bucket, key, at) select 'companion_call_voice_all', 'all', now() from generate_series(1, $1)`, [CALL_VOICE_ALL.perHour]);
    const busy = await speak(me.cookie, mine, replies);
    expect(busy.status).toBe(503);
    expect(((await busy.res.json()) as Any).error).toBe("busy");
    expect(deepgram).toEqual([]);
  });

  it("is off without the key, or with COMPANION_LIVE off: the call says it in the device's voice", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const ids = await said(me.cookie, id, true);
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    const off = await speak(me.cookie, id, ids);
    expect(off.status).toBe(404);
    expect(((await off.res.json()) as Any).error).toBe("voice_off");
    vi.stubEnv("DEEPGRAM_API_KEY", FAKE_KEY);
    vi.stubEnv("COMPANION_LIVE", "off");
    expect((await speak(me.cookie, id, ids)).status).toBe(404);
    expect(deepgram).toEqual([]);
  });

  it("says why when Aura is down, never logging the words", async () => {
    auraDown = true;
    const me = member();
    const id = await thread(me.cookie);
    const ids = await said(me.cookie, id, true);
    const r = await speak(me.cookie, id, ids);
    expect(r.status).toBe(503);
    expect(((await r.res.json()) as Any).error).toBe("voice_down");
    expect(logged.join("\n")).not.toContain("ferry");
  });

  it("needs a session that may talk with a companion at all", async () => {
    const res = await speakRoute(req(`/api/companion/x/speak`, { message_ids: ["y"] }, "bz_adult=1"), ctx("x"));
    expect([401, 404]).toContain(res.status);
    expect(deepgram).toEqual([]);
  });
});

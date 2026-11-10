import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { GET as viewRoute } from "@/app/api/companion/[id]/route";
import { POST as liveRoute } from "@/app/api/companion/[id]/live/route";
import { setCompanionModelForTests } from "@/lib/companion";
import { extraState } from "@/lib/companion-extras";
import {
  auraVoiceFor,
  chargeLiveCall,
  endLiveCall,
  liveCall,
  liveCallsOn,
  mintSttToken,
  setDeepgramFetchForTests,
  startLiveCall,
  sttUrl,
} from "@/lib/companion-live";
import {
  BARGE_IN_WORDS,
  ClauseSplitter,
  deepgramHeard,
  echoOf,
  heardSoFar,
  LIVE_START,
  liveStep,
  minutesDue,
  pcmSamples,
  spokenClause,
  toPcm16,
  type LiveEvent,
  type LiveState,
} from "@/lib/companion-live-shared";
import { extraPrice, extraTerms } from "@/lib/companion-shared";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage, ModelOptions } from "@/lib/model";
import { grantPlan } from "@/lib/paid-plans";
import { sseData } from "@/lib/sse";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A stand-in server key, never a real one: built from parts so no scanner mistakes it for a secret. */
const FAKE_KEY = ["dg", "test", "not", "a", "key"].join("-");
const FAKE_TOKEN = ["jwt", "for", "tests"].join(".");

/* ------------------------------------------------- the pure half ------------------------------------------------- */

describe("cutting a streamed reply into pieces", () => {
  it("cuts at a sentence's end as the words come, never at Dr. or 3.5", () => {
    const s = new ClauseSplitter();
    expect(s.push("Hi")).toEqual([]);
    expect(s.push("! Dr. Okafor said 3.5 ")).toEqual(["Hi!"]);
    expect(s.push("stars. Wild")).toEqual(["Dr. Okafor said 3.5 stars."]);
    expect(s.flush()).toEqual(["Wild"]);
  });

  it("lets the first piece end at a comma once it's long enough, so the first words come sooner", () => {
    const s = new ClauseSplitter();
    expect(s.push("Okay so the ferry was late again, and then ")).toEqual(["Okay so the ferry was late again,"]);
    // Only the first: later pieces wait for the sentence.
    expect(s.push("the captain, bless him, ")).toEqual([]);
    expect(s.push("sang. ")).toEqual(["and then the captain, bless him, sang."]);
  });

  it("cuts a piece with no end at a space past the longest", () => {
    const s = new ClauseSplitter();
    const out = s.push(`${"word ".repeat(60)}`);
    expect(out.length).toBe(1);
    expect(out[0].length).toBeLessThanOrEqual(240);
  });

  it("makes a piece sayable: no name in front, no *action*, no emoji or quotes", () => {
    expect(spokenClause('Nell: "Ha! *grins* That\'s great 😄"', "Nell Okafor")).toBe("Ha! That's great");
    expect(spokenClause("*waves*", "Nell Okafor")).toBe("");
    expect(spokenClause("Nell: not a name in a later piece", "Nell Okafor", false)).toBe("Nell: not a name in a later piece");
  });
});

describe("turn-taking and barge-in", () => {
  const words = (text: string, isFinal = true, speechFinal = false) => ({ kind: "words" as const, text, isFinal, speechFinal });

  it("gathers what's settled and sends it when their speech ends", () => {
    let s: LiveState = LIVE_START;
    s = liveStep(s, words("so I baked", false)).state;
    expect(heardSoFar(s)).toBe("so I baked");
    s = liveStep(s, words("so I baked bread")).state;
    const r = liveStep(s, words("today", true, true));
    expect(r.effects).toEqual([{ kind: "send", text: "so I baked bread today" }]);
    expect(r.state.phase).toBe("thinking");
  });

  it("sends on UtteranceEnd when speech_final never came, with the words still being heard", () => {
    let s = liveStep(LIVE_START, words("hello there", false)).state;
    const r = liveStep(s, { kind: "utterance_end" });
    expect(r.effects).toEqual([{ kind: "send", text: "hello there" }]);
    s = r.state;
    expect(liveStep(s, { kind: "utterance_end" }).effects).toEqual([]);
  });

  it("stops them when the person talks over them: their voice and the reply in flight go", () => {
    let s = liveStep(LIVE_START, words("hi", true, true)).state;
    s = liveStep(s, { kind: "reply_started" }).state;
    s = liveStep(s, { kind: "reply_text", text: "Busy week. I fixed three radios." }).state;
    expect(s.phase).toBe("speaking");
    const r = liveStep(s, words("wait hold on", false));
    expect(r.effects).toEqual([{ kind: "barge_in" }]);
    expect(r.state.phase).toBe("listening");
    expect(heardSoFar(r.state)).toBe("wait hold on");
    // Their words then go in as the next turn.
    expect(liveStep(r.state, words("wait hold on", true, true)).effects).toEqual([{ kind: "send", text: "wait hold on" }]);
  });

  it("doesn't stop for a cough, one word, or their own voice coming back through the speaker", () => {
    let s = liveStep(LIVE_START, words("hi", true, true)).state;
    s = liveStep(liveStep(s, { kind: "reply_started" }).state, { kind: "reply_text", text: "Busy week. I fixed three radios and broke one." }).state;
    expect(BARGE_IN_WORDS).toBe(2);
    expect(liveStep(s, words("mm", false)).effects).toEqual([]);
    expect(echoOf("fixed three radios", s.replying)).toBe(true);
    expect(liveStep(s, words("I fixed three radios", false)).effects).toEqual([]);
    expect(liveStep(s, { kind: "reply_done" }).state).toMatchObject({ phase: "listening", replying: "" });
  });

  it("drops the reply on Interrupt, and does nothing when the floor's already theirs", () => {
    const speaking: LiveState = { ...LIVE_START, phase: "speaking", replying: "hi" };
    expect(liveStep(speaking, { kind: "interrupt" }).effects).toEqual([{ kind: "barge_in" }]);
    expect(liveStep(LIVE_START, { kind: "interrupt" }).effects).toEqual([]);
  });

  it("reads Deepgram's messages", () => {
    expect(deepgramHeard(JSON.stringify({ type: "Results", is_final: true, speech_final: true, channel: { alternatives: [{ transcript: "hey" }] } }))).toEqual({
      kind: "words",
      text: "hey",
      isFinal: true,
      speechFinal: true,
    });
    expect(deepgramHeard(JSON.stringify({ type: "UtteranceEnd" }))).toEqual({ kind: "utterance_end" });
    expect(deepgramHeard(JSON.stringify({ type: "SpeechStarted" }))).toBeNull();
    expect(deepgramHeard("not json")).toBeNull();
  });

  it("turns the microphone into 16 kHz PCM and their voice back into samples", () => {
    const pcm = toPcm16(new Float32Array(48_000).fill(0.5), 48_000);
    expect(pcm.byteLength).toBe(16_000 * 2);
    const b64 = Buffer.from(pcm).toString("base64");
    const back = pcmSamples(b64);
    expect(back.length).toBe(16_000);
    expect(back[0]).toBeCloseTo(0.5, 3);
  });
});

describe("minutes", () => {
  it("counts a minute as it starts, with a little grace at the boundary", () => {
    expect(minutesDue(0, 0)).toBe(1);
    expect(minutesDue(0, 64_000)).toBe(1);
    expect(minutesDue(0, 66_000)).toBe(2);
    expect(minutesDue(0, 10 * 60_000)).toBe(10);
  });

  it("are settable on the server, and priced in minutes", () => {
    expect(extraTerms("minute", {})).toMatchObject({ included: 20, bundle: 10, tokens: 1 });
    expect(extraTerms("minute", { COMPANION_LIVE_INCLUDED: "0", COMPANION_LIVE_BUNDLE: "15" })).toMatchObject({ included: 0, bundle: 15 });
    expect(extraTerms("minute", { COMPANION_LIVE_BUNDLE: "0" }).bundle).toBe(10);
    expect(extraPrice("minute", { free: false, included_left: null, credits: 0, tokens: 1, bundle: 10, tokens_left: 3 })).toBe("1 token for 10 minutes");
    expect(extraPrice("minute", { free: false, included_left: null, credits: 4, tokens: 1, bundle: 10, tokens_left: 3 })).toBe("");
  });
});

/* -------------------------------------------- the switch and Deepgram -------------------------------------------- */

describe("the switch", () => {
  it("is off with no key, for guests, at COMPANION_LIVE=0, and admins-only at COMPANION_LIVE=admins", () => {
    const user = { admin: false, guest: false };
    expect(liveCallsOn({}, user)).toBe(false);
    expect(liveCallsOn({ DEEPGRAM_API_KEY: FAKE_KEY }, user)).toBe(true);
    expect(liveCallsOn({ DEEPGRAM_API_KEY: FAKE_KEY }, { admin: false, guest: true })).toBe(false);
    expect(liveCallsOn({ DEEPGRAM_API_KEY: FAKE_KEY, COMPANION_LIVE: "0" }, user)).toBe(false);
    expect(liveCallsOn({ DEEPGRAM_API_KEY: FAKE_KEY, COMPANION_LIVE: "admins" }, user)).toBe(false);
    expect(liveCallsOn({ DEEPGRAM_API_KEY: FAKE_KEY, COMPANION_LIVE: "admins" }, { admin: true, guest: false })).toBe(true);
  });

  it("listens with Deepgram's streaming settings, opted out of its training, and never puts the key in the URL", () => {
    const url = new URL(sttUrl({ DEEPGRAM_API_KEY: FAKE_KEY }, "en-GB"));
    expect(url.origin).toBe("wss://api.deepgram.com");
    expect(url.pathname).toBe("/v1/listen");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      model: "nova-3",
      language: "en",
      encoding: "linear16",
      sample_rate: "16000",
      interim_results: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
      mip_opt_out: "true",
    });
    expect(url.toString()).not.toContain(FAKE_KEY);
    expect(new URL(sttUrl({}, "fr-FR")).searchParams.get("language")).toBe("multi");
  });

  it("picks one Aura voice per character, by their pronouns", () => {
    const c = HOUSE_CHARACTERS[0];
    expect(auraVoiceFor(c)).toBe(auraVoiceFor(c));
    expect(auraVoiceFor({ id: "x1", pronouns: "she/her" })).toMatch(/^aura-2-(thalia|andromeda|helena|luna|asteria|athena|cora|aurora)-en$/);
    expect(auraVoiceFor({ id: "x1", pronouns: "he/him" })).toMatch(/^aura-2-(apollo|arcas|orion|zeus|hermes|atlas|orpheus|jupiter)-en$/);
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

const CAST = HOUSE_CHARACTERS[0];
/** Aura's voice, faked: 0.1 s of a tone and an odd byte (whole samples only ever go to the browser). */
const PCM = Buffer.alloc(4801, 7);

let deepgram: { url: string; auth: string | null; body: Any }[] = [];
let grantDown = false;
let auraDown = false;
let pieces: string[] = [];
let gate: Promise<void> | null = null;
let streamed: { messages: ChatMessage[]; options?: ModelOptions }[] = [];
let completed = 0;
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
  grantDown = false;
  auraDown = false;
  pieces = ["Oh, hi! ", "It's good ", "to hear you. ", "What's new?"];
  gate = null;
  streamed = [];
  completed = 0;
  setDeepgramFetchForTests(async (input, init) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    deepgram.push({ url, auth, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/v1/auth/grant")) {
      return grantDown ? new Response("nope", { status: 403 }) : Response.json({ access_token: FAKE_TOKEN, expires_in: 30 });
    }
    if (url.includes("/v1/speak?")) {
      if (auraDown) return new Response("down", { status: 500 });
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(PCM.subarray(0, 1001)));
            c.enqueue(new Uint8Array(PCM.subarray(1001)));
            c.close();
          },
        }),
      );
    }
    return new Response("unexpected", { status: 404 });
  });
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (system.startsWith("You are ")) {
        completed++;
        return JSON.stringify({ messages: ["Drawn whole, the v1 way."] });
      }
      return "{}";
    },
    async *stream(messages, options) {
      streamed.push({ messages, options });
      for (const [i, p] of pieces.entries()) {
        if (i === 1 && gate) await gate;
        if (options?.signal?.aborted) return;
        yield p;
      }
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setDeepgramFetchForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const person = async (opts: { admin?: boolean; tokens?: number; plan?: boolean } = {}) => {
  const id = crypto.randomUUID();
  if (opts.admin) await t.db.query("insert into admins (user_id) values ($1)", [id]);
  if (opts.tokens) await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), id, opts.tokens]);
  if (opts.plan) await grantPlan(t.db, id, "companion", "initial", { subscriptionId: `sub_${id.slice(0, 8)}` });
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const req = (path: string, body: unknown, cookie?: string, method = "POST") =>
  new Request(BASE_URL + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function thread(cookie: string): Promise<string> {
  const res = await openRoute(req("/api/companion", { character_id: CAST.id }, cookie));
  return ((await res.json()) as Any).thread_id as string;
}
async function live(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await liveRoute(req(`/api/companion/${id}/live`, body, cookie), ctx(id));
  return { status: res.status, res, body: res.headers.get("content-type")?.includes("json") ? ((await res.json()) as Any) : null };
}
async function events(res: Response, stopAfter?: (e: LiveEvent) => boolean): Promise<LiveEvent[]> {
  const out: LiveEvent[] = [];
  const body = res.body!;
  for await (const data of sseData(body)) {
    const e = JSON.parse(data) as LiveEvent;
    out.push(e);
    if (stopAfter?.(e)) break;
  }
  return out;
}
const messages = async (threadId: string) =>
  (await t.db.query<{ role: string; text: string; on_call: boolean }>(`select role, text, on_call from companion_messages where thread_id = $1 and role <> 'system' order by created_at, id`, [threadId])).rows;
const replies = async (userId: string) => (await t.db.query<{ replies: number }>(`select replies from companion_usage where user_id = $1`, [userId])).rows[0]?.replies ?? 0;

describe("off", () => {
  it("is v1 with no key: the thread page offers no live call and the route is not found", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    const me = await person();
    const id = await thread(me.cookie);
    const r = await live(me.cookie, id, { action: "start" });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("live_off");
    expect(deepgram).toEqual([]);
  });

  it("is for accounts only", async () => {
    const guest = `bz_adult=1`;
    const opened = await openRoute(req("/api/companion", { character_id: CAST.id }, guest));
    const id = ((await opened.json()) as Any).thread_id as string | undefined;
    const r = await live(guest, id ?? "none", { action: "start" });
    expect([401, 404]).toContain(r.status);
    expect(deepgram).toEqual([]);
  });
});

describe("starting a call", () => {
  it("mints a short-lived token from the server key and hands the browser only that", async () => {
    const me = await person({ admin: true });
    const id = await thread(me.cookie);
    const r = await live(me.cookie, id, { action: "start", lang: "en-US" });
    expect(r.status).toBe(200);
    expect(r.body.stt.token).toBe(FAKE_TOKEN);
    expect(r.body.stt.url).toMatch(/^wss:\/\/api\.deepgram\.com\/v1\/listen\?/);
    expect(JSON.stringify(r.body)).not.toContain(FAKE_KEY);
    expect(deepgram[0]).toMatchObject({ url: "https://api.deepgram.com/v1/auth/grant", auth: `Token ${FAKE_KEY}`, body: { ttl_seconds: 30 } });
    expect(r.body.call.minutes).toBe(1);
    // Admins aren't counted.
    expect((await extraState(t.db, me.id, "minute")).free).toBe(true);
    expect(logged.join("\n")).not.toContain(FAKE_KEY);
  });

  it("shows the price before the first minute is bought, and takes a token for a bundle only when asked", async () => {
    const me = await person({ tokens: 2 });
    const id = await thread(me.cookie);
    const priced = await live(me.cookie, id, { action: "start" });
    expect(priced.status).toBe(402);
    expect(priced.body).toMatchObject({ error: "price", price: { tokens: 1, bundle: 10 } });
    expect(extraPrice("minute", priced.body.extras.minute)).toBe("1 token for 10 minutes");
    expect(deepgram).toEqual([]);
    const bought = await live(me.cookie, id, { action: "start", buy: true });
    expect(bought.status).toBe(200);
    expect(bought.body.extras.minute.credits).toBe(9);
  });

  it("takes the plan's included minutes first", async () => {
    const me = await person({ plan: true });
    const id = await thread(me.cookie);
    const r = await live(me.cookie, id, { action: "start" });
    expect(r.status).toBe(200);
    expect(r.body.extras.minute.included_left).toBe(19);
  });

  it("charges nothing and goes the free way when Deepgram won't give a token", async () => {
    grantDown = true;
    const me = await person({ tokens: 1 });
    const id = await thread(me.cookie);
    const r = await live(me.cookie, id, { action: "start", buy: true });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("live_down");
    const s = await extraState(t.db, me.id, "minute");
    expect(s.credits).toBe(0);
    expect(s.tokens_left).toBe(1);
  });
});

describe("by the minute", () => {
  it("takes each minute as it starts, pauses for the price when they run out, and ends at the longest", async () => {
    const me = await person({ tokens: 1 });
    const id = await thread(me.cookie);
    const t0 = new Date("2026-11-10T12:00:00Z");
    const started = await startLiveCall(t.db, me.id, id, { buy: true, now: t0 });
    if (!started.ok) throw new Error("should start");
    const call = started.call;
    const at = (ms: number) => new Date(t0.getTime() + ms);
    expect(await chargeLiveCall(t.db, call, { now: at(30_000) })).toEqual({ ok: true, minutes: 1 });
    expect(await chargeLiveCall(t.db, call, { now: at(4 * 60_000 + 10_000) })).toEqual({ ok: true, minutes: 5 });
    expect((await extraState(t.db, me.id, "minute")).credits).toBe(5);
    expect(await chargeLiveCall(t.db, call, { now: at(10 * 60_000 + 10_000) })).toMatchObject({ ok: false, status: 402, error: "needs_tokens" });
    expect(call.minutes).toBe(10);
    vi.stubEnv("COMPANION_LIVE_MAX_MINUTES", "10");
    expect(await chargeLiveCall(t.db, call, { now: at(11 * 60_000) })).toMatchObject({ ok: false, status: 409, error: "too_long" });
    expect((await liveCall(t.db, me.id, call.id, id))?.ended_at).toBeTruthy();
  });

  it("gives the first minute back for a call that ends at once with nothing said", async () => {
    const me = await person({ plan: true });
    const id = await thread(me.cookie);
    const t0 = new Date();
    const started = await startLiveCall(t.db, me.id, id, { now: t0 });
    if (!started.ok) throw new Error("should start");
    expect((await extraState(t.db, me.id, "minute")).included_left).toBe(19);
    expect(await endLiveCall(t.db, started.call, new Date(t0.getTime() + 5_000))).toEqual({ minutes: 0, refunded: true });
    expect((await extraState(t.db, me.id, "minute")).included_left).toBe(20);
  });

  it("counts a tick over the route, and a fresh token needs the minutes paid", async () => {
    const me = await person({ admin: true });
    const id = await thread(me.cookie);
    const s = await live(me.cookie, id, { action: "start" });
    const tick = await live(me.cookie, id, { action: "tick", call_id: s.body.call.id });
    expect(tick.status).toBe(200);
    const token = await live(me.cookie, id, { action: "token", call_id: s.body.call.id });
    expect(token.body.stt.token).toBe(FAKE_TOKEN);
    const end = await live(me.cookie, id, { action: "end", call_id: s.body.call.id, seconds: 3 });
    expect(end.body.refunded).toBe(true);
    expect((await live(me.cookie, id, { action: "tick", call_id: s.body.call.id })).status).toBe(409);
    // Someone else's call isn't theirs to use.
    const other = await person({ admin: true });
    expect((await live(other.cookie, id, { action: "tick", call_id: s.body.call.id })).status).toBe(404);
  });
});

describe("a turn", () => {
  /** A call going: an admin's (free), or someone's whose first minute a bought token paid for. */
  async function started(opts: { admin?: boolean } = { admin: true }) {
    const me = await person(opts.admin ? { admin: true } : { tokens: 1 });
    const id = await thread(me.cookie);
    const s = await live(me.cookie, id, { action: "start", buy: !opts.admin });
    expect(s.status).toBe(200);
    // The opener drew a reply whole: count from here.
    completed = 0;
    return { me, id, call: s.body.call.id as string };
  }

  it("streams the reply piece by piece, each with its voice, and keeps both lines marked 📞", async () => {
    const { me, id, call } = await started({});
    const before = await replies(me.id);
    const r = await live(me.cookie, id, { action: "turn", call_id: call, text: "hi, can you hear me" });
    expect(r.res.headers.get("content-type")).toContain("text/event-stream");
    const evs = await events(r.res);
    const said = evs.filter((e) => e.type === "say").map((e) => (e as Any).text);
    expect(said).toEqual(["Oh, hi!", "It's good to hear you.", "What's new?"]);
    const audio = evs.filter((e) => e.type === "audio") as Extract<LiveEvent, { type: "audio" }>[];
    expect(audio.length).toBeGreaterThan(0);
    // Whole samples only.
    for (const a of audio) expect(Buffer.from(a.pcm, "base64").length % 2).toBe(0);
    expect(evs.filter((e) => e.type === "audio_end").map((e) => (e as Any).i)).toEqual([0, 1, 2]);
    const done = evs.at(-1) as Extract<LiveEvent, { type: "done" }>;
    expect(done).toMatchObject({ type: "done", text: "Oh, hi! It's good to hear you. What's new?" });
    // Aura was asked for each checked piece, in the character's voice, opted out of training.
    const spoken = deepgram.filter((d) => d.url.includes("/v1/speak?"));
    expect(spoken.map((d) => d.body.text)).toEqual(said);
    expect(spoken[0].url).toContain(`model=${auraVoiceFor(CAST)}`);
    expect(spoken[0].url).toContain("mip_opt_out=true");
    expect(spoken[0].auth).toBe(`Token ${FAKE_KEY}`);
    // The prompt: a call, live (plain text), short.
    expect(streamed[0].messages[0].content).toContain("on a voice call with them");
    expect(streamed[0].messages[0].content).toContain("as plain text");
    expect(streamed[0].options?.maxTokens).toBe(250);
    const kept = await messages(id);
    expect(kept.slice(-2)).toEqual([
      { role: "user", text: "hi, can you hear me", on_call: true },
      { role: "character", text: "Oh, hi! It's good to hear you. What's new?", on_call: true },
    ]);
    expect(await replies(me.id)).toBe(before + 1);
    // No audio and no key in any log line.
    const all = logged.join("\n");
    expect(all).not.toContain(PCM.subarray(0, 1000).toString("base64").slice(0, 40));
    expect(all).not.toContain(FAKE_KEY);
    const turns = (await t.db.query<{ turns: number; tts_chars: number }>(`select turns, tts_chars from companion_live_calls where id = $1`, [call])).rows[0];
    expect(turns.turns).toBe(1);
    expect(turns.tts_chars).toBe(said.join("").length);
  });

  it("stops the reply at a piece over the PG line, keeping only what was checked", async () => {
    pieces = ["Ha, okay. ", "Take your clothes off and have sex with me. ", "Anyway!"];
    const { id, call, me } = await started();
    const evs = await events((await live(me.cookie, id, { action: "turn", call_id: call, text: "tell me something" })).res);
    expect(evs.filter((e) => e.type === "say").map((e) => (e as Any).text)).toEqual(["Ha, okay."]);
    expect((await messages(id)).at(-1)).toMatchObject({ role: "character", text: "Ha, okay." });
  });

  it("draws the reply whole the v1 way when its first piece fails a check", async () => {
    pieces = ["I want to kill myself. ", "Kidding."];
    const { id, call, me } = await started();
    const evs = await events((await live(me.cookie, id, { action: "turn", call_id: call, text: "how are you" })).res);
    expect(completed).toBe(1);
    expect(evs.filter((e) => e.type === "say").map((e) => (e as Any).text)).toEqual(["Drawn whole, the v1 way."]);
    expect((await messages(id)).at(-1)).toMatchObject({ text: "Drawn whole, the v1 way.", on_call: true });
  });

  it("keeps the same checks on what they say: the crisis resources pause it, the PG line refuses it, neither kept", async () => {
    const { me, id, call } = await started({});
    const before = await replies(me.id);
    const crisis = await live(me.cookie, id, { action: "turn", call_id: call, text: "honestly I want to kill myself" });
    expect(crisis.body.crisis_resources).toBeTruthy();
    expect(await replies(me.id)).toBe(before);
    expect((await messages(id)).some((m) => m.text.includes("kill myself"))).toBe(false);
    expect(streamed).toEqual([]);
    const me2 = await started({});
    const pg = await live(me2.me.cookie, me2.id, { action: "turn", call_id: me2.call, text: "Take your clothes off and have sex with me" });
    expect(pg.status).toBe(422);
    expect(pg.body.error).toBe("refused");
  });

  it("stops when they talk over it (the browser drops the stream): what was said is kept, the rest never written", async () => {
    let open!: () => void;
    gate = new Promise<void>((ok) => (open = ok));
    const { me, id, call } = await started();
    const r = await live(me.cookie, id, { action: "turn", call_id: call, text: "go on" });
    const reader = r.res.body!.getReader();
    const decoder = new TextDecoder();
    let got = "";
    while (!got.includes('"type":"say"')) {
      const { value, done } = await reader.read();
      if (done) break;
      got += decoder.decode(value);
    }
    expect(got).toContain('"text":"Oh, hi!"');
    // The browser drops the stream (a barge-in aborts its fetch).
    await reader.cancel();
    open();
    for (let i = 0; i < 50 && !(await messages(id)).some((m) => m.role === "character" && m.text === "Oh, hi!"); i++) await new Promise((ok) => setTimeout(ok, 20));
    expect((await messages(id)).at(-1)).toMatchObject({ role: "character", text: "Oh, hi!", on_call: true });
  });

  it("carries on in the device's voice when Aura fails", async () => {
    auraDown = true;
    const { me, id, call } = await started();
    const evs = await events((await live(me.cookie, id, { action: "turn", call_id: call, text: "hello" })).res);
    expect(evs.some((e) => e.type === "voice_off")).toBe(true);
    expect(evs.filter((e) => e.type === "say")).toHaveLength(3);
    expect(evs.at(-1)?.type).toBe("done");
  });

  it("asks for the price again when the minutes have run out mid-call", async () => {
    const me = await person({ tokens: 1 });
    const id = await thread(me.cookie);
    const s = await live(me.cookie, id, { action: "start", buy: true });
    // Ten minutes on, the bundle's used up and no token's left.
    await t.db.query(`update companion_live_calls set started_at = now() - interval '10 minutes 10 seconds' where id = $1`, [s.body.call.id]);
    const r = await live(me.cookie, id, { action: "turn", call_id: s.body.call.id, text: "still there?" });
    expect(r.status).toBe(402);
    expect(r.body.price).toEqual({ tokens: 1, bundle: 10 });
    expect(streamed).toEqual([]);
  });

  it("is listed in the thread like any call line", async () => {
    const { me, id, call } = await started();
    await events((await live(me.cookie, id, { action: "turn", call_id: call, text: "hey there" })).res);
    const view = ((await (await viewRoute(req(`/api/companion/${id}`, null, me.cookie, "GET"), ctx(id))).json()) as Any).view;
    expect(view.messages.filter((m: Any) => m.call).map((m: Any) => m.text)).toEqual(["hey there", "Oh, hi! It's good to hear you. What's new?"]);
  });
});

describe("the token", () => {
  it("is null without a key or when Deepgram refuses", async () => {
    expect(await mintSttToken({})).toBeNull();
    grantDown = true;
    expect(await mintSttToken({ DEEPGRAM_API_KEY: FAKE_KEY })).toBeNull();
  });
});

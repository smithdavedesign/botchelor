import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as compareGet, POST as comparePost } from "@/app/api/admin/live-face/compare/route";
import { GET as mineGet, POST as minePost } from "@/app/api/me/live-face/route";
import { claimAdmin } from "@/lib/admins";
import { registerAccount } from "@/lib/auth";
import { saveConnection } from "@/lib/connections";
import { curatedModels, PROVIDER_INFO, providersFor } from "@/lib/connections-shared";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { GET as clipGet } from "@/app/api/live-face/clip/[id]/route";
import { liveFaceClips, liveFaceSession } from "@/lib/live-face";
import { compareState, keysFor, LIVE_FACE_CHOICES, pcmOfWav, rateRender, rendererListing, setUserLiveFaceChoice, userLiveFaceChoice } from "@/lib/live-face/compare";
import { CHAIN_FADE_IN, CHAIN_FADE_OUT, CHAIN_TAIL_SILENCE_MS, type ChainClip, DittoChain, speakDittoStream } from "@/lib/live-face/ditto";
import { dittoLibrary, ensureDittoLibrary, LIBRARY_SPEC, libraryClipFile } from "@/lib/live-face/ditto-clips";
import { DITTO_EMO, emoFor } from "@/lib/live-face-shared";
import { RUNPOD_API, setRunpodFetchForTests } from "@/lib/live-face/musetalk";
import { DID_API, didTalk, FAL_QUEUE, falRun, falVideo, RENDERERS, rendererById, runnableRenderers, setRendererFetchForTests } from "@/lib/live-face/renderers";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

/** A route handler called as the browser would: a cookie, a JSON body. */
const call = (handler: (req: Request) => Promise<Response>, path: string, opts: { cookie?: string; body?: unknown } = {}) =>
  handler(new Request(`${BASE_URL}${path}`, { method: opts.body === undefined ? "GET" : "POST", headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.body === undefined ? {} : { "content-type": "application/json" }) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
/** A signed-in person: their user id and the cookie that signs them in. */
const someone = () => { const raw = newUserCookie(); const userId = userIdOf(raw); return { userId, cookie: signedInCookie(userId) }; };

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// The renderer compare (lib/live-face/compare.ts, lib/live-face/renderers.ts): one interface over ours and the hosted
// models, the hosted clients against stand-ins, the ratings, and a person's own pick of renderer for their calls.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("KEY_ENCRYPTION_SECRET", "0".repeat(64));
  vi.stubEnv("LIVE_FACE_PROVIDER", "musetalk");
  vi.stubEnv("RUNPOD_API_KEY", "placeholder-runpod");
  vi.stubEnv("LIVE_FACE_ENDPOINT", "ep-1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setRendererFetchForTests(null);
  setRunpodFetchForTests(null);
});

const RAFE = HOUSE_CHARACTERS[0].id;
const MP4 = Buffer.from("ftypisom-not-really-an-mp4");

describe("the renderer registry", () => {
  it("lists ours first, the hosted batch models, D-ID and Simli, and knows which can render a clip", () => {
    expect(RENDERERS[0].id).toBe("musetalk");
    expect(RENDERERS[1]).toMatchObject({ id: "ditto", provider: "house", kind: "live", runs: true });
    expect(RENDERERS.slice(2, 5).map((r) => r.id)).toEqual(["ditto:soft", "ditto:cast", "ditto:loop"]);
    expect(RENDERERS.map((r) => r.provider)).toEqual(expect.arrayContaining(["house", "fal", "replicate", "did", "simli"]));
    expect(runnableRenderers().map((r) => r.id)).not.toContain("simli");
    expect(rendererById("fal:sync-lipsync-2")?.model).toBe("fal-ai/sync-lipsync/v2");
    expect(rendererById("fal:echomimic-v3")).toMatchObject({ provider: "fal", kind: "batch", model: "fal-ai/echomimic-v3" });
    expect(rendererById("fal:omnihuman-1.5")).toMatchObject({ provider: "fal", kind: "batch", model: "fal-ai/bytedance/omnihuman/v1.5" });
    expect(rendererById("nope")).toBeNull();
  });
  it("is what the Connections offer for the live-face job: fal, Replicate and D-ID keys, with the renderers as the models", () => {
    expect(providersFor("live_face")).toEqual(["replicate", "fal", "did"]);
    expect(curatedModels("fal", "live_face").map((m) => m.id)).toContain("fal:omnihuman");
    expect(curatedModels("replicate", "live_face").find((m) => m.recommended)?.id).toBe("replicate:wan-2.2-s2v");
    expect(PROVIDER_INFO.fal.keysUrl).toMatch(/fal\.ai/);
  });
  it("reads the PCM out of Aura's WAV", () => {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    const wav = Buffer.concat([header, Buffer.from([1, 2, 3, 4])]);
    expect(pcmOfWav(wav)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(pcmOfWav(Buffer.from([9, 9]))).toEqual(Buffer.from([9, 9]));
  });
});

describe("fal.ai's queue, as its docs say", () => {
  it("submits with the key, polls the status until COMPLETED, reads the response and downloads its video", async () => {
    const asked: string[] = [];
    let polls = 0;
    setRendererFetchForTests(async (input, init) => {
      const url = String(input);
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "https://cdn.fal/out.mp4") return new Response(new Uint8Array(MP4)); // the CDN: no key
      if (new Headers(init?.headers).get("authorization") !== "Key fal-k") return Response.json({ detail: "Authentication is required" }, { status: 401 });
      if (url === `${FAL_QUEUE}/fal-ai/kling-video/lipsync/audio-to-video` && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ image_url: "https://x/p.png", audio_url: "https://x/a.wav" });
        // A nested model: the job's URLs sit under the app id, not the model's path.
        return Response.json({ request_id: "req-1", status_url: `${FAL_QUEUE}/fal-ai/kling-video/requests/req-1/status`, response_url: `${FAL_QUEUE}/fal-ai/kling-video/requests/req-1` });
      }
      if (url === `${FAL_QUEUE}/fal-ai/kling-video/requests/req-1/status`) return Response.json({ status: ++polls < 2 ? "IN_PROGRESS" : "COMPLETED" });
      if (url === `${FAL_QUEUE}/fal-ai/kling-video/requests/req-1`) return Response.json({ video: { url: "https://cdn.fal/out.mp4" }, seed: 1 });
      if (url === "https://cdn.fal/out.mp4") return new Response(new Uint8Array(MP4));
      return Response.json({ error: "unknown" }, { status: 404 });
    });
    const { output } = await falRun("fal-k", "fal-ai/kling-video/lipsync/audio-to-video", { image_url: "https://x/p.png", audio_url: "https://x/a.wav" }, { everyMs: 1 });
    expect(await falVideo(output)).toEqual(MP4);
    expect(asked[0]).toBe(`POST ${FAL_QUEUE}/fal-ai/kling-video/lipsync/audio-to-video`);
    expect(asked.filter((a) => a.endsWith("/status")).length).toBe(2);
  });
  it("gives up on a status URL that never answers instead of waiting out the clock", async () => {
    setRendererFetchForTests(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return Response.json({ request_id: "req-9", status_url: `${FAL_QUEUE}/fal-ai/nope/requests/req-9/status` });
      if (url.endsWith("/status")) return Response.json({ detail: "Not Found" }, { status: 404 });
      return Response.json({}, { status: 404 });
    });
    await expect(falRun("fal-k", "fal-ai/nope", {}, { everyMs: 1, timeoutMs: 60_000 })).rejects.toThrow(/status 404/);
  });
  it("says so when the key is refused, and when the job answers no video", async () => {
    setRendererFetchForTests(async () => Response.json({ detail: "Authentication is required" }, { status: 401 }));
    await expect(falRun("bad", "fal-ai/infinitalk", {}, { everyMs: 1 })).rejects.toThrow(/fal\.ai 401/);
    await expect(falVideo({ seed: 3 })).rejects.toThrow(/no video/);
  });
});

describe("D-ID's Talks", () => {
  it("creates a talk from the portrait and the audio URL, polls it, and hands back the result's URL", async () => {
    let polls = 0;
    setRendererFetchForTests(async (input, init) => {
      const url = String(input);
      if (new Headers(init?.headers).get("authorization") !== "Basic did-k") return Response.json({ kind: "Unauthorized" }, { status: 401 });
      if (url === `${DID_API}/talks` && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { source_url: string; script: { type: string; audio_url: string } };
        expect(body.source_url).toBe("https://x/p.png");
        expect(body.script).toEqual({ type: "audio", audio_url: "https://x/a.wav" });
        return Response.json({ id: "tlk-1", status: "created" }, { status: 201 });
      }
      if (url === `${DID_API}/talks/tlk-1`) return Response.json(++polls < 2 ? { status: "started" } : { status: "done", result_url: "https://d-id/out.mp4" });
      return Response.json({ error: "unknown" }, { status: 404 });
    });
    const r = await didTalk("did-k", "https://x/p.png", "https://x/a.wav", { everyMs: 1 });
    expect(r.resultUrl).toBe("https://d-id/out.mp4");
  });
});

describe("whose key a renderer runs on", () => {
  it("is the person's own Connection when they have one, else the house key, else none; ours needs only the endpoint", async () => {
    const { userId } = someone();
    await registerAccount(t.db, userId, "keysfor", "a-good-password-1"); // a Connection belongs to an account
    const before = await keysFor(t.db, userId, { SIMLI_API_KEY: "house-simli" });
    expect(before.fal.from).toBeNull();
    expect(before.simli).toEqual({ apiKey: "house-simli", from: "house" });
    await saveConnection(t.db, userId, "fal", "my-fal-key");
    const after = await keysFor(t.db, userId); // the sealed key opens under the server's secrets
    expect(after.fal).toEqual({ apiKey: "my-fal-key", from: "yours" });
    const listing = await rendererListing(t.db, userId, { ...process.env, RUNPOD_API_KEY: "k", LIVE_FACE_ENDPOINT: "ep", SIMLI_API_KEY: undefined });
    expect(listing.find((r) => r.id === "musetalk")).toMatchObject({ ready: true, key: "house" });
    expect(listing.find((r) => r.id === "ditto")).toMatchObject({ ready: false, key: "house" }); // its own endpoint isn't set
    const withDitto = await rendererListing(t.db, userId, { ...process.env, RUNPOD_API_KEY: "k", LIVE_FACE_ENDPOINT: undefined, LIVE_FACE_DITTO_ENDPOINT: "ep-d" });
    expect(withDitto.find((r) => r.id === "ditto")?.ready).toBe(true);
    expect(withDitto.find((r) => r.id === "musetalk")?.ready).toBe(false);
    expect(listing.find((r) => r.id === "fal:omnihuman")).toMatchObject({ ready: true, key: "yours" });
    expect(listing.find((r) => r.id === "replicate:wan-2.2-s2v")?.ready).toBe(false);
    expect(listing.find((r) => r.id === "simli")?.ready).toBe(false);
  });
});

describe("Ditto, our second worker", () => {
  it("sends the kit's portrait and the clause to its own endpoint as a speak job and reads the clip back", async () => {
    const asked: { url: string; body: Record<string, unknown> | undefined }[] = [];
    setRunpodFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { input?: Record<string, unknown> }).input : undefined;
      asked.push({ url, body });
      if (new Headers(init?.headers).get("authorization") !== "Bearer placeholder-runpod") return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (!url.startsWith(`${RUNPOD_API}/ep-d/runsync`)) return Response.json({ error: "no such endpoint" }, { status: 404 });
      return Response.json({ id: "job-d", status: "COMPLETED", output: { video_b64: MP4.toString("base64"), mime: "video/mp4", frames: 50, fps: 25, width: 512, height: 512, bytes: MP4.length, ms: { source: 40, setup: 300, audio: 60, render: 900, encode: 30, total: 1330 } } });
    });
    const ditto = rendererById("ditto")!;
    const env = { RUNPOD_API_KEY: "placeholder-runpod", LIVE_FACE_DITTO_ENDPOINT: "ep-d" };
    const pcm = Buffer.alloc(96_000); // two seconds at 24 kHz
    const input = { characterId: RAFE, portraitUrl: "https://botchelor.com/api/face-kit/x/portrait.webp", loopUrl: "https://botchelor.com/api/face-kit/x/loop.mp4", audio: { pcm, wav: pcm, rate: 24_000, seconds: 2, url: "https://botchelor.com/api/live-face/audio/a.wav" }, bundleKey: null };
    const out = await ditto.speak(input, { apiKey: null, env });
    expect(out.mp4.equals(MP4)).toBe(true);
    expect(out).toMatchObject({ frames: 50, note: "512px, 50 frames, from the portrait, as a call renders it" });
    expect(out.cost_usd).toBeGreaterThan(0);
    // As a call renders a clause: eased in and out at the portrait, the line's expression (none here: a plain line).
    expect(asked[0].body).toMatchObject({ op: "speak", source_url: input.portraitUrl, audio_format: "pcm16", rate: 24_000, fade_in: CHAIN_FADE_IN, fade_out: CHAIN_FADE_OUT, tail_silence_ms: CHAIN_TAIL_SILENCE_MS });
    expect(asked[0].body?.audio_b64).toBe(pcm.toString("base64"));
    // A calmer mouth: the same job with the driving weights turned down.
    await rendererById("ditto:soft")!.speak(input, { apiKey: null, env });
    expect(asked[asked.length - 1].body).toMatchObject({ source_url: input.portraitUrl, exp_scale: 0.7, pose_scale: 0.85 });
    // From the cast portrait, when the character has one; refused when not.
    await rendererById("ditto:cast")!.speak({ ...input, castPortraitUrl: "https://botchelor.com/api/assets/cast-1" }, { apiKey: null, env });
    expect(asked[asked.length - 1].body).toMatchObject({ source_url: "https://botchelor.com/api/assets/cast-1" });
    await expect(rendererById("ditto:cast")!.speak(input, { apiKey: null, env })).rejects.toThrow(/no approved cast portrait/);
    // Ditto on the loop: the same job with the kit's loop as the source, from the cycle's first frame, expression-only fades on the worker's side.
    const onLoop = await rendererById("ditto:loop")!.speak(input, { apiKey: null, env });
    expect(onLoop.mp4.equals(MP4)).toBe(true);
    expect(asked[asked.length - 1].body).toMatchObject({ op: "speak", source_url: input.loopUrl, audio_format: "pcm16", fade_in: CHAIN_FADE_IN, fade_out: CHAIN_FADE_OUT });
    expect(asked[asked.length - 1].body).not.toHaveProperty("start_frame");
    // Without its endpoint it says so instead of calling MuseTalk's
    await expect(ditto.speak(input, { apiKey: null, env: { RUNPOD_API_KEY: "placeholder-runpod", LIVE_FACE_ENDPOINT: "ep-1" } })).rejects.toThrow(/LIVE_FACE_DITTO_ENDPOINT/);
    // A worker failure is the renderer's error, not a clip
    setRunpodFetchForTests(async () => Response.json({ id: "job-d", status: "FAILED", error: "the clause is empty" }));
    await expect(ditto.speak(input, { apiKey: null, env })).rejects.toThrow(/the clause is empty/);
  });

  /** Ditto's endpoint, faked for a chain: every speak answers a clip named by its turn and, when asked, a state named the same; a clause of "bad" fails. */
  function fakeChainEndpoint() {
    const asked: Record<string, unknown>[] = [];
    let n = 0;
    setRunpodFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { input?: Record<string, unknown> }).input : undefined;
      if (!url.startsWith(`${RUNPOD_API}/ep-d/runsync`) || !body) return Response.json({ error: "no such endpoint" }, { status: 404 });
      asked.push(body);
      n++;
      if (body.audio_b64 === Buffer.from("bad").toString("base64")) return Response.json({ id: `job-${n}`, status: "FAILED", error: "the clause is empty" });
      return Response.json({ id: `job-${n}`, status: "COMPLETED", output: { video_b64: `clip${n}`, mime: "video/mp4", frames: 40, fps: 25, width: 512, height: 512, bytes: 5, handler: "chain-1", ms: { total: 500 }, ...(body.want_state ? { state_b64: `state${n}` } : {}) } });
    });
    return asked;
  }
  const CFG = { key: "placeholder-runpod", endpoint: "ep-d" };
  const PORTRAIT = "https://botchelor.com/api/face-kit/p.webp";

  it("renders a reply as one chain: the first clause eases in from the still, each next takes the state the one before answered, the last gets silence and the fade out", async () => {
    const asked = fakeChainEndpoint();
    const clips: ChainClip[] = [];
    const failed: number[] = [];
    const chain = new DittoChain(CFG, PORTRAIT, 24_000, { clip: (c) => clips.push(c), fail: (i) => failed.push(i) }, { decideMs: 30 });
    chain.expect(0);
    chain.expect(1);
    chain.expect(2);
    chain.add(0, Buffer.from("one"), { emo: DITTO_EMO.happy });
    chain.add(1, Buffer.from("two"));
    chain.add(2, Buffer.from("three"), { emo: DITTO_EMO.surprise });
    chain.finish();
    await chain.done();
    expect(clips.map((c) => [c.i, c.mp4, c.last])).toEqual([
      [0, "clip1", false],
      [1, "clip2", false],
      [2, "clip3", true],
    ]);
    // The clause's expression bank goes with it; none means the worker's neutral.
    expect(asked[0]).toMatchObject({ op: "speak", source_url: PORTRAIT, audio_format: "pcm16", rate: 24_000, fade_in: CHAIN_FADE_IN, want_state: true, emo: DITTO_EMO.happy });
    expect(asked[1]).not.toHaveProperty("emo");
    expect(asked[2]).toMatchObject({ emo: DITTO_EMO.surprise });
    expect(asked[0]).not.toHaveProperty("state_b64");
    expect(asked[0]).not.toHaveProperty("fade_out");
    expect(asked[1]).toMatchObject({ state_b64: "state1", want_state: true });
    expect(asked[1]).not.toHaveProperty("fade_in");
    expect(asked[2]).toMatchObject({ state_b64: "state2", fade_out: CHAIN_FADE_OUT, tail_silence_ms: CHAIN_TAIL_SILENCE_MS });
    expect(asked[2]).not.toHaveProperty("want_state");
    expect(failed).toEqual([]);
    expect(chain.stats).toEqual({ clips: 3, failed: 0 });
  });

  it("waits a moment for a clause whose place isn't known, breaks the chain at a failed clause and starts again from the still", async () => {
    const asked = fakeChainEndpoint();
    const clips: ChainClip[] = [];
    const failed: number[] = [];
    const chain = new DittoChain(CFG, PORTRAIT, 24_000, { clip: (c) => clips.push(c), fail: (i) => failed.push(i) }, { decideMs: 30 });
    chain.expect(0);
    chain.add(0, Buffer.from("one"));
    // Nothing named after it and the reply not over: it waits, then renders as not the last.
    await new Promise((ok) => setTimeout(ok, 10));
    expect(asked.length).toBe(0);
    await new Promise((ok) => setTimeout(ok, 60));
    expect(asked.length).toBe(1);
    expect(asked[0]).toMatchObject({ want_state: true });
    expect(asked[0]).not.toHaveProperty("fade_out");
    chain.expect(1);
    chain.expect(2);
    chain.add(1, Buffer.from("bad"));
    chain.add(2, Buffer.from("three"));
    chain.finish();
    await chain.done();
    expect(failed).toEqual([1]);
    expect(clips.map((c) => [c.i, c.last])).toEqual([
      [0, false],
      [2, true],
    ]);
    // After the break: a chain again from the still (no state, the fade in), and the last.
    expect(asked[2]).toMatchObject({ fade_in: CHAIN_FADE_IN, fade_out: CHAIN_FADE_OUT });
    expect(asked[2]).not.toHaveProperty("state_b64");
    expect(chain.stats).toEqual({ clips: 2, failed: 1 });
  });

  it("reads a clause's expression from its words: laughs and warmth are happy, gasps surprise, sorrow sad, the rest neutral", () => {
    expect(emoFor("Hahaha, you did not.")).toBe(DITTO_EMO.happy);
    expect(emoFor("*laughs* okay, okay")).toBe(DITTO_EMO.happy);
    expect(emoFor("I love that you remembered.")).toBe(DITTO_EMO.happy);
    expect(emoFor("Wait, what? You did what?")).toBe(DITTO_EMO.surprise);
    expect(emoFor("No way!")).toBe(DITTO_EMO.surprise);
    expect(emoFor("I'm so sorry. That's hard.")).toBe(DITTO_EMO.sad);
    expect(emoFor("Found a new draft in the lantern room. It hums.")).toBe(DITTO_EMO.neutral);
    expect(emoFor("Watch out!")).toBe(DITTO_EMO.neutral);
    expect(emoFor("")).toBe(DITTO_EMO.neutral);
  });

  it("renders a character's idle and reactions once (silence with a pose motion, fading in and out at the still), keeps them, serves them, and gives a Ditto session their URLs", async () => {
    const { userId } = someone();
    await t.db.query(`insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'm', $3, 'approved', 'pg')`, [`asset-${RAFE}`, RAFE, "/cast/house-juniper-v3.webp"]);
    await t.db.query(`insert into face_kits (id, character_id, source_id, part, status, mime, data) values ($1, $2, $3, 'portrait', 'ready', 'image/webp', $4)`, [`kit-portrait-${RAFE}`, RAFE, `asset-${RAFE}`, Buffer.from("webp")]);
    const asked = fakeChainEndpoint();
    const env = { RUNPOD_API_KEY: "placeholder-runpod", LIVE_FACE_DITTO_ENDPOINT: "ep-d", LIVE_FACE_PROVIDER: "ditto" };
    expect(await dittoLibrary(t.db, RAFE, "http://test")).toEqual({ idle: null, reactions: {}, complete: false });
    expect(await ensureDittoLibrary(t.db, RAFE, "http://test", env)).toBe(4);
    expect(asked.map((a) => [(a.motion as { kind: string }).kind, a.fade_in, a.fade_out, (a.audio_b64 as string).length > 0, a.emo])).toEqual([
      ["sway", LIBRARY_SPEC.idle.fade_in, LIBRARY_SPEC.idle.fade_out, true, 4],
      ["nod", LIBRARY_SPEC.nod.fade_in, LIBRARY_SPEC.nod.fade_out, true, 4],
      ["tilt", LIBRARY_SPEC.tilt.fade_in, LIBRARY_SPEC.tilt.fade_out, true, 4],
      ["sway", LIBRARY_SPEC.brow.fade_in, LIBRARY_SPEC.brow.fade_out, true, 6],
    ]);
    // Eight seconds of silence at 24 kHz, 16-bit mono, for the idle.
    expect(Buffer.from(asked[0].audio_b64 as string, "base64").length).toBe(8 * 24_000 * 2);
    expect(asked[0]).not.toHaveProperty("want_state");
    const lib = await dittoLibrary(t.db, RAFE, "http://test");
    expect(lib.complete).toBe(true);
    expect(lib.idle).toMatch(/^\/api\/live-face\/clip\//);
    expect(Object.keys(lib.reactions).sort()).toEqual(["brow", "nod", "tilt"]);
    // Kept and served; asking again renders nothing more.
    const id = lib.idle!.split("/").pop()!;
    expect((await libraryClipFile(t.db, id))?.bytes.equals(Buffer.from("clip1", "base64"))).toBe(true);
    const served = await clipGet(new Request(`${BASE_URL}/api/live-face/clip/${id}`), { params: Promise.resolve({ id }) });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("video/mp4");
    expect((await clipGet(new Request(`${BASE_URL}/api/live-face/clip/nope`), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
    expect(await ensureDittoLibrary(t.db, RAFE, "http://test", env)).toBe(0);
    expect(asked.length).toBe(4);
    // A Ditto session carries them (the clips route's tests cover the session's making in lib/live-face).
    vi.stubEnv("LIVE_FACE_PROVIDER", "ditto");
    vi.stubEnv("LIVE_FACE_DITTO_ENDPOINT", "ep-d");
    const session = await liveFaceSession(t.db, RAFE, "http://test", { admin: true, userId });
    expect(session).toMatchObject({ provider: "ditto", px: 512, idle: lib.idle, reactions: lib.reactions });
  });

  it("gives a reply up when its first clause fails: the clauses waiting and any added after are failed at once, nothing more is rendered", async () => {
    const asked = fakeChainEndpoint();
    const clips: ChainClip[] = [];
    const failed: number[] = [];
    const chain = new DittoChain(CFG, PORTRAIT, 24_000, { clip: (c) => clips.push(c), fail: (i) => failed.push(i) }, { decideMs: 30 });
    chain.expect(0);
    chain.expect(1);
    chain.expect(2);
    chain.add(0, Buffer.from("bad"));
    chain.add(1, Buffer.from("two"));
    await new Promise((ok) => setTimeout(ok, 20));
    chain.add(2, Buffer.from("three"));
    chain.finish();
    await chain.done();
    expect(asked.length).toBe(1);
    expect(clips).toEqual([]);
    expect(failed).toEqual([0, 1, 2]);
    expect(chain.stats).toEqual({ clips: 0, failed: 1 });
  });

  /** Ditto's endpoint, faked for streams: /run queues a job, /stream yields its items two a poll (start, the state when asked, two pieces, end; "bad" fails). */
  function fakeStreamEndpoint() {
    const asked: Record<string, unknown>[] = [];
    const runs: string[] = [];
    const firstCursorAtRun: number[] = [];
    const jobs = new Map<string, { items: unknown[]; cursor: number }>();
    let n = 0;
    setRunpodFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { input?: Record<string, unknown> }).input : undefined;
      if (url.endsWith("/ep-d/run") && body) {
        n++;
        const id = `job-${n}`;
        asked.push(body);
        runs.push(id);
        firstCursorAtRun.push(jobs.get("job-1")?.cursor ?? -1);
        const bad = body.audio_b64 === Buffer.from("bad").toString("base64");
        const items = bad
          ? [{ error: "the clause is empty" }]
          : [
              { kind: "start", frames: 40, fps: 25, width: 512, height: 512 },
              ...(body.want_state ? [{ kind: "state", state_b64: `state${n}` }] : []),
              { kind: "frag", i: 0, b64: Buffer.from(`init${n}`).toString("base64") },
              { kind: "frag", i: 1, b64: Buffer.from(`moof${n}`).toString("base64") },
              { kind: "end", frames: 40, pieces: 2, bytes: 10, first_piece_ms: 300, ms: { total: 900 } },
            ];
        jobs.set(id, { items, cursor: 0 });
        return Response.json({ id, status: "IN_QUEUE" });
      }
      const m = url.match(/\/ep-d\/stream\/(job-\d+)$/);
      if (m) {
        const j = jobs.get(m[1])!;
        const take = j.items.slice(j.cursor, j.cursor + 2);
        j.cursor += take.length;
        const done = j.cursor >= j.items.length;
        const failed = done && j.items.some((it) => Boolean((it as { error?: string }).error));
        return Response.json({ id: m[1], status: done ? (failed ? "FAILED" : "COMPLETED") : "IN_PROGRESS", stream: take.map((output) => ({ output })) });
      }
      if (url.includes("/cancel/")) return Response.json({ status: "CANCELLED" });
      return Response.json({ error: "no such endpoint" }, { status: 404 });
    });
    return { asked, runs, firstCursorAtRun };
  }

  it("streams a clause: start, the state before the frames, the pieces in order, the end; a worker failure is the error", async () => {
    const { asked } = fakeStreamEndpoint();
    const got: string[] = [];
    const end = await speakDittoStream(CFG, { source_url: PORTRAIT, pcm: Buffer.from("one"), rate: 24_000, want_state: true, fade_in: 6 }, { start: (i) => got.push(`start:${i.frames}`), state: (s) => got.push(`state:${s}`), frag: (i, b) => got.push(`frag${i}:${b.toString()}`) });
    expect(got).toEqual(["start:40", "state:state1", "frag0:init1", "frag1:moof1"]);
    expect(end).toMatchObject({ frames: 40, pieces: 2 });
    expect(asked[0]).toMatchObject({ op: "speak", stream: true, want_state: true, fade_in: 6, source_url: PORTRAIT });
    await expect(speakDittoStream(CFG, { source_url: PORTRAIT, pcm: Buffer.from("bad"), rate: 24_000 }, { frag: () => {} })).rejects.toThrow(/the clause is empty/);
  });

  it("streamed, the chain queues the next clause the moment the state lands (before the previous frames are done), and hands the pieces on per clause in order", async () => {
    const { asked, runs, firstCursorAtRun } = fakeStreamEndpoint();
    const events: string[] = [];
    const chain = new DittoChain(CFG, PORTRAIT, 24_000, { start: (i) => events.push(`start${i}`), frag: (i, seq, b) => events.push(`frag${i}.${seq}=${b.toString()}`), end: (i, info) => events.push(`end${i}${info.last ? ":last" : ""}`), fail: (i) => events.push(`fail${i}`) }, { decideMs: 30 });
    expect(chain.streams).toBe(true);
    chain.expect(0);
    chain.expect(1);
    chain.expect(2);
    chain.add(0, Buffer.from("one"));
    chain.add(1, Buffer.from("two"));
    chain.add(2, Buffer.from("three"));
    chain.finish();
    await chain.done();
    expect(runs).toEqual(["job-1", "job-2", "job-3"]);
    // The second job was queued once the first's state was in (two items read), not after its end (five).
    expect(firstCursorAtRun[1]).toBe(2);
    expect(asked[1]).toMatchObject({ state_b64: "state1", stream: true });
    expect(asked[2]).toMatchObject({ state_b64: "state2", fade_out: CHAIN_FADE_OUT, tail_silence_ms: CHAIN_TAIL_SILENCE_MS });
    expect(events.filter((e) => e.startsWith("frag0."))).toEqual(["frag0.0=init1", "frag0.1=moof1"]);
    expect(events).toContain("end2:last");
    expect(events.some((e) => e.startsWith("fail"))).toBe(false);
    expect(chain.stats).toEqual({ clips: 3, failed: 0 });
  });

  it("stops with the turn: once aborted nothing more is asked for and done() resolves", async () => {
    const asked = fakeChainEndpoint();
    const ctl = new AbortController();
    const chain = new DittoChain(CFG, PORTRAIT, 24_000, { clip: () => {}, fail: () => {} }, { decideMs: 30, signal: ctl.signal });
    chain.expect(0);
    chain.expect(1);
    chain.add(0, Buffer.from("one"));
    await new Promise((ok) => setTimeout(ok, 10));
    ctl.abort();
    chain.add(1, Buffer.from("two"));
    chain.finish();
    await chain.done();
    expect(asked.length).toBe(1);
  });
});

describe("a compare's renders and ratings", () => {
  it("keep a 1–5 per render, read back with the compare, and the admin route guards it", async () => {
    const { userId, cookie } = someone();
    await claimAdmin(t.db, userId);
    await t.db.query(`insert into live_face_compares (id, user_id, character_id, line, voice, audio_seconds) values ('c1', $1, $2, 'A line.', 'aura-2-thalia-en', 1.5)`, [userId, RAFE]);
    await t.db.query(`insert into live_face_renders (id, compare_id, renderer, provider, model, status, ms, cost_usd) values ('11111111-1111-4111-8111-111111111111', 'c1', 'musetalk', 'house', 'MuseTalk 1.5', 'done', 2100, 0.0008)`);
    expect(await rateRender(t.db, "11111111-1111-4111-8111-111111111111", 4)).toBe(true);
    const state = await compareState(t.db, "c1");
    expect(state?.renders[0]).toMatchObject({ renderer: "musetalk", status: "done", rating: 4, ms: 2100 });
    const page = await call(compareGet, "/api/admin/live-face/compare", { cookie });
    expect(page.status).toBe(200);
    const data = (await page.json()) as { renderers: { id: string }[]; averages: { renderer: string; average: number }[]; compares: unknown[] };
    expect(data.renderers.map((r) => r.id)).toContain("musetalk");
    expect(data.averages).toEqual([{ renderer: "musetalk", rated: 1, average: 4 }]);
    expect(data.compares.length).toBe(1);
    const rated = await call(comparePost, "/api/admin/live-face/compare", { cookie, body: { action: "rate", render_id: "11111111-1111-4111-8111-111111111111", rating: null } });
    expect(await rated.json()).toEqual({ rated: true });
    const stranger = await call(compareGet, "/api/admin/live-face/compare", { cookie: someone().cookie });
    expect(stranger.status).toBe(404);
  });
});

describe("a person's renderer for their own calls", () => {
  it("defaults to auto, is set through /api/me/live-face, and Simli means no clips for them", async () => {
    const { userId, cookie } = someone();
    expect(LIVE_FACE_CHOICES).toEqual(["auto", "musetalk", "ditto", "simli"]);
    expect(await userLiveFaceChoice(t.db, userId)).toBe("auto");
    expect(await (await call(minePost, "/api/me/live-face", { cookie, body: { renderer: "ditto" } })).json()).toEqual({ renderer: "ditto" });
    expect(await userLiveFaceChoice(t.db, userId)).toBe("ditto");
    const set = await call(minePost, "/api/me/live-face", { cookie, body: { renderer: "simli" } });
    expect(await set.json()).toEqual({ renderer: "simli" });
    expect(((await (await call(mineGet, "/api/me/live-face", { cookie })).json()) as { renderer: string }).renderer).toBe("simli");
    expect(await liveFaceClips(t.db, RAFE, "http://test", { admin: true, userId })).toBeNull();
    await setUserLiveFaceChoice(t.db, userId, "auto");
    expect(await userLiveFaceChoice(t.db, userId)).toBe("auto");
    const anon = await call(mineGet, "/api/me/live-face", {});
    expect(anon.status).toBe(401);
  });
});

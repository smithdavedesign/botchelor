import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as compareGet, POST as comparePost } from "@/app/api/admin/live-face/compare/route";
import { GET as mineGet, POST as minePost } from "@/app/api/me/live-face/route";
import { claimAdmin } from "@/lib/admins";
import { registerAccount } from "@/lib/auth";
import { saveConnection } from "@/lib/connections";
import { curatedModels, PROVIDER_INFO, providersFor } from "@/lib/connections-shared";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { liveFaceClips } from "@/lib/live-face";
import { compareState, keysFor, pcmOfWav, rateRender, rendererListing, setUserLiveFaceChoice, userLiveFaceChoice } from "@/lib/live-face/compare";
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
    expect(RENDERERS.map((r) => r.provider)).toEqual(expect.arrayContaining(["house", "fal", "replicate", "did", "simli"]));
    expect(runnableRenderers().map((r) => r.id)).not.toContain("simli");
    expect(rendererById("fal:sync-lipsync-2")?.model).toBe("fal-ai/sync-lipsync/v2");
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
    expect(out).toMatchObject({ frames: 50, note: "512px, 50 frames, from the portrait" });
    expect(out.cost_usd).toBeGreaterThan(0);
    expect(asked[0].body).toMatchObject({ op: "speak", source_url: input.portraitUrl, audio_format: "pcm16", rate: 24_000 });
    expect(asked[0].body?.audio_b64).toBe(pcm.toString("base64"));
    // Without its endpoint it says so instead of calling MuseTalk's
    await expect(ditto.speak(input, { apiKey: null, env: { RUNPOD_API_KEY: "placeholder-runpod", LIVE_FACE_ENDPOINT: "ep-1" } })).rejects.toThrow(/LIVE_FACE_DITTO_ENDPOINT/);
    // A worker failure is the renderer's error, not a clip
    setRunpodFetchForTests(async () => Response.json({ id: "job-d", status: "FAILED", error: "the clause is empty" }));
    await expect(ditto.speak(input, { apiKey: null, env })).rejects.toThrow(/the clause is empty/);
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
    expect(await userLiveFaceChoice(t.db, userId)).toBe("auto");
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

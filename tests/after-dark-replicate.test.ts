import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { GET as mediaGet } from "@/app/api/admin/after-dark/media/[id]/route";
import { DELETE as reelDelete, GET as reelGet, POST as reelPost } from "@/app/api/admin/after-dark/reel/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { reelFailureNote } from "@/lib/adult/reel-failure";
import { replicateTiming, replicateVoice, setReelFetchForTests, setReelPausesForTests, voiceFor, type Reel } from "@/lib/adult/reels";
import { downloadOutput, predictionRequest, ReplicateError, runModel, setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { adultKeys, DEFAULT_REPLICATE_VOICE_MODEL, getAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { normalizeScene } from "@/lib/venues";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Replicate as After Dark's backup media provider (lib/adult/replicate.ts, David 2026-10-22): no live calls here.
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
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setReplicatePausesForTests(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReplicateFetchForTests(null);
  setReelFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
});

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const settings = (body: Record<string, unknown>, cookie: string) => call(settingsPost, "/api/admin/after-dark/settings", body, cookie);
const scripted = (reply: string) => setAdultModelForTests({ complete: async () => reply });
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const WAV = new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]);
const KEYFRAME = "qwen/qwen-image-edit-2511";
const VIDEO = "wan-video/wan-2.2-i2v-fast";
const VOICE_VERSION = DEFAULT_REPLICATE_VOICE_MODEL.split(":")[1];

type Seen = { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> | undefined };
/**
 * A stand-in for Replicate: pictures, keyframes and voices finish within the `Prefer: wait`; a video is still
 * processing when it's first asked about, then done. Files come from replicate.delivery. Records every request.
 */
function fakeReplicate(opts: { create?: (model: string) => Response | null; done?: (id: string) => Record<string, unknown> | null } = {}) {
  const seen: Seen[] = [];
  const made = new Map<string, string>();
  const asked = new Map<string, number>();
  let n = 0;
  setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    seen.push({ method: init?.method ?? "GET", url, headers, body });
    if (url.startsWith("https://replicate.delivery/")) {
      const [bytes, type] = url.endsWith(".mp4") ? [MP4, "video/mp4"] : url.endsWith(".wav") ? [WAV, "audio/wav"] : [PNG, "image/png"];
      return new Response(bytes, { headers: { "content-type": type } });
    }
    const official = url.match(/^https:\/\/api\.replicate\.com\/v1\/models\/([^/]+)\/([^/]+)\/predictions$/);
    if (init?.method === "POST" && (official || url === "https://api.replicate.com/v1/predictions")) {
      const model = official ? `${official[1]}/${official[2]}` : String(body?.version);
      const refused = opts.create?.(model);
      if (refused) return refused;
      const id = `p${++n}`;
      made.set(id, model);
      if (model === VIDEO) return Response.json({ id, status: "starting" }, { status: 201 });
      const output = model === VOICE_VERSION ? `https://replicate.delivery/xe/${id}/output.wav` : [`https://replicate.delivery/xe/${id}/out-0.png`];
      return Response.json({ id, status: "succeeded", output }, { status: 201 });
    }
    const cancel = url.match(/\/v1\/predictions\/([^/]+)\/cancel$/);
    if (cancel) return Response.json({ id: cancel[1], status: "canceled" });
    const got = url.match(/\/v1\/predictions\/([^/]+)$/);
    if (got) {
      const times = (asked.get(got[1]) ?? 0) + 1;
      asked.set(got[1], times);
      const custom = opts.done?.(got[1]);
      if (custom) return Response.json({ id: got[1], ...custom });
      return Response.json(times === 1 ? { id: got[1], status: "processing" } : { id: got[1], status: "succeeded", output: `https://replicate.delivery/xe/${got[1]}/output.mp4` });
    }
    return new Response("unexpected", { status: 500 });
  });
  const creates = (model: string) => seen.filter((s) => s.method === "POST" && (s.url.includes(`/models/${model}/predictions`) || (s.body?.version === model && s.url.endsWith("/v1/predictions"))));
  return { seen, creates };
}

/** Hive (V3): moderation with no child, the VLM saying everyone's an adult; `refuse` picks calls to refuse. */
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const CHILD_MOD = { output: [{ classes: [{ class: "no_child_present", value: 0.5 }, { class: "yes_child_present", value: 0.5 }] }] };
const vlmSays = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });
function fakeHive(refuse: (n: { mod: number; vlm: number; vlmCall: boolean }) => unknown = () => null) {
  const checks: { kind: "moderation" | "vlm"; base64: boolean }[] = [];
  let mod = 0;
  let vlm = 0;
  setCheckFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const isVlm = String(input) === HIVE_VLM;
    const body = String(init?.body ?? "");
    checks.push({ kind: isVlm ? "vlm" : "moderation", base64: body.includes("media_base64") || body.includes("data:") });
    const n = { mod: isVlm ? mod : mod++, vlm: isVlm ? vlm++ : vlm, vlmCall: isVlm };
    const custom = refuse(n);
    if (custom) return Response.json(custom);
    return Response.json(isVlm ? vlmSays('{"answer": "ADULTS"}') : CLEAN_MOD);
  });
  return checks;
}

describe("the Replicate client", () => {
  it("runs an official model by name, any model by version, and refuses anything else", () => {
    expect(predictionRequest("qwen/qwen-image-edit-2511", { a: 1 })).toEqual({ url: "https://api.replicate.com/v1/models/qwen/qwen-image-edit-2511/predictions", body: { input: { a: 1 } } });
    expect(predictionRequest(DEFAULT_REPLICATE_VOICE_MODEL, { text: "hi" })).toEqual({ url: "https://api.replicate.com/v1/predictions", body: { version: VOICE_VERSION, input: { text: "hi" } } });
    expect(predictionRequest(VOICE_VERSION, {}).body).toEqual({ version: VOICE_VERSION, input: {} });
    for (const bad of ["", "qwen", "https://evil.example/x", "a/b/c", "a/b:short"]) expect(() => predictionRequest(bad, {})).toThrow(ReplicateError);
  });

  it("waits up to a minute, polls past it, and downloads what it made at once; a model that never finishes is stopped", async () => {
    const seen: Seen[] = [];
    let polls = 0;
    setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ method: init?.method ?? "GET", url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/predictions")) return Response.json({ id: "abc", status: "starting" }, { status: 201 });
      if (url.endsWith("/predictions/abc")) return Response.json(++polls < 3 ? { id: "abc", status: "processing" } : { id: "abc", status: "succeeded", output: ["https://replicate.delivery/xe/abc/out-0.png"] });
      if (url.startsWith("https://replicate.delivery/")) return new Response(PNG, { headers: { "content-type": "image/png" } });
      return new Response("?", { status: 500 });
    });
    const file = await runModel("r8_test", "qwen/qwen-image", { prompt: "p" }, { maxBytes: 1000 });
    expect(file).toEqual({ bytes: Buffer.from(PNG), mime: "image/png" });
    expect(seen[0].headers).toMatchObject({ authorization: "Bearer r8_test", prefer: "wait=60", "cancel-after": "5m" });
    expect(seen.filter((s) => s.url.endsWith("/predictions/abc"))).toHaveLength(3);
    // Our token never goes to the file host.
    expect(seen.find((s) => s.url.startsWith("https://replicate.delivery/"))!.headers).toEqual({});

    seen.length = 0;
    setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ method: init?.method ?? "GET", url, headers: {}, body: undefined });
      return url.endsWith("/predictions") ? Response.json({ id: "slow", status: "starting" }, { status: 201 }) : Response.json({ id: "slow", status: "processing" });
    });
    await expect(runModel("r8_test", "qwen/qwen-image", {}, { maxBytes: 1000, timeoutMs: 10_000 })).rejects.toThrow(/took longer/);
    expect(seen.some((s) => s.method === "POST" && s.url.endsWith("/predictions/slow/cancel"))).toBe(true);
  });

  it("says why Replicate refused, and what a failed prediction said", async () => {
    setReplicateFetchForTests(async () =>
      Response.json({ title: "Insufficient credit", detail: "You have insufficient credit to run this model. Go to https://replicate.com/account/billing#billing to purchase credit." }, { status: 402 }),
    );
    const err = await runModel("r8_test", "qwen/qwen-image", {}, { maxBytes: 1000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReplicateError);
    expect((err as ReplicateError).status).toBe(402);
    expect((err as Error).message).toMatch(/^Replicate 402: You have insufficient credit/);
    expect(reelFailureNote([{ status: "failed", reason: (err as Error).message }])).toMatch(/Replicate, which makes the videos, is out of credit/);
    setReplicateFetchForTests(async () => Response.json({ id: "x", status: "failed", error: "CUDA out of memory" }, { status: 201 }));
    await expect(runModel("r8_test", "qwen/qwen-image", {}, { maxBytes: 1000 })).rejects.toThrow("Replicate: CUDA out of memory");
    setReplicateFetchForTests(async () => Response.json({ id: "x", status: "succeeded", output: null }, { status: 201 }));
    await expect(runModel("r8_test", "qwen/qwen-image", {}, { maxBytes: 1000 })).rejects.toThrow(/no longer has it/);
  });

  it("downloads only from Replicate itself (or a data: URI), and nothing too large", async () => {
    const asked: string[] = [];
    setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(`${String(input)} ${(init?.headers as Record<string, string> | undefined)?.authorization ?? ""}`.trim());
      return new Response(new Uint8Array(64), { headers: { "content-type": "application/octet-stream" } });
    });
    await expect(downloadOutput("https://evil.example/out.png", "r8_test", 1000)).rejects.toThrow(/host we don't fetch from/);
    await expect(downloadOutput("http://replicate.delivery/x.png", "r8_test", 1000)).rejects.toThrow(/host we don't fetch from/);
    expect(asked).toEqual([]);
    expect(await downloadOutput(`data:audio/wav;base64,${Buffer.from(WAV).toString("base64")}`, "r8_test", 1000)).toEqual({ bytes: Buffer.from(WAV), mime: "audio/wav" });
    // The type from the name when the host doesn't say; the token only to Replicate's own API.
    expect((await downloadOutput("https://pbxt.replicate.delivery/a/output.wav", "r8_test", 1000)).mime).toBe("audio/wav");
    await downloadOutput("https://api.replicate.com/v1/files/f1/download", "r8_test", 1000);
    expect(asked).toEqual(["https://pbxt.replicate.delivery/a/output.wav", "https://api.replicate.com/v1/files/f1/download Bearer r8_test"]);
    await expect(downloadOutput("https://replicate.delivery/big.mp4", "r8_test", 10)).rejects.toThrow(/too large/);
  });

  it("gives every voice of ours one Replicate's Kokoro has, and each shot long enough for its line", () => {
    // jaaari/kokoro-82m's voice list, its American English voices (2026-10-22).
    const KOKORO = ["af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck"];
    const ours = new Set<string>();
    for (const pronouns of ["she/her", "he/him", "they/them"]) for (let k = 0; k < 400; k++) ours.add(voiceFor({ id: `character-${k}`, pronouns }));
    expect(ours.has("af_heart")).toBe(true);
    for (const v of ours) expect(KOKORO).toContain(replicateVoice(v));
    expect(replicateVoice("af_heart")).toBe("af_alloy");
    for (const v of KOKORO) expect(replicateVoice(v)).toBe(v);

    const words = (n: number) => Array.from({ length: n }, (_, k) => `w${k}`).join(" ");
    expect(replicateTiming(words(4))).toEqual({ frames: 81, speed: 1 });
    expect(replicateTiming(words(12))).toEqual({ frames: 85, speed: 1 });
    expect(replicateTiming(words(24))).toEqual({ frames: 121, speed: 1.25 });
    for (let n = 1; n <= 24; n++) {
      const { frames, speed } = replicateTiming(words(n));
      expect((frames - 1) % 4).toBe(0);
      expect(frames).toBeGreaterThanOrEqual(81);
      expect(frames).toBeLessThanOrEqual(121);
      expect(speed).toBeGreaterThanOrEqual(1);
      expect(speed).toBeLessThanOrEqual(1.25);
    }
  });
});

describe("the settings", () => {
  it("seal the Replicate token like the others, switch the provider, and validate the models and LoRA", async () => {
    const { cookie } = await admin();
    const before = await getAdultSettings(t.db);
    expect(before).toMatchObject({
      media_provider: "venice",
      replicate_picture_model: "qwen/qwen-image",
      replicate_keyframe_model: KEYFRAME,
      replicate_video_model: VIDEO,
      replicate_voice_model: DEFAULT_REPLICATE_VOICE_MODEL,
      replicate_video_lora: null,
      replicate_last4: null,
      replicate_from_env: false,
      text_model: "deepseek/deepseek-chat-v3.1",
    });
    const saved = await (await settings({ media_provider: "replicate", replicate_key: "placeholder-replicate-RPLC", replicate_video_lora: "https://huggingface.co/x/y/resolve/main/high.safetensors https://huggingface.co/x/y/resolve/main/low.safetensors" }, cookie)).json();
    expect(saved.settings).toMatchObject({ media_provider: "replicate", replicate_last4: "RPLC", replicate_from_env: false });
    expect(JSON.stringify(saved)).not.toContain("placeholder-replicate");
    const row = (await t.db.query<{ replicate_ciphertext: string; replicate_last4: string }>(`select replicate_ciphertext, replicate_last4 from adult_settings`)).rows[0];
    expect(row.replicate_ciphertext).not.toContain("placeholder");
    expect((await adultKeys(t.db)).replicate).toBe("placeholder-replicate-RPLC");
    // A model has to be one (owner/name, or with its version); a LoRA, https links; "" puts the default back.
    expect((await settings({ replicate_video_model: "not a model" }, cookie)).status).toBe(422);
    expect((await settings({ replicate_video_lora: "http://insecure.example/lora.safetensors" }, cookie)).status).toBe(422);
    expect((await settings({ replicate_picture_model: "adirik/realvisxl-v4.0:85a58cc71587cc27539b7c83eb1ce4aea02feedfb9a9fae0598cebc110a3d695" }, cookie)).status).toBe(200);
    expect((await (await settings({ replicate_picture_model: "" }, cookie)).json()).settings.replicate_picture_model).toBe("qwen/qwen-image");
    // Removing the saved token.
    expect((await (await settings({ replicate_key: "" }, cookie)).json()).settings.replicate_last4).toBeNull();
    expect((await adultKeys(t.db)).replicate).toBeNull();
  });

  it("fall back to the server's REPLICATE_API_TOKEN when none is saved, and say so without showing it; a saved one wins", async () => {
    const { cookie } = await admin();
    vi.stubEnv("REPLICATE_API_TOKEN", "r8_from-the-environment-ENVT");
    const s = await getAdultSettings(t.db);
    expect(s).toMatchObject({ replicate_last4: null, replicate_from_env: true });
    expect(JSON.stringify(s)).not.toContain("from-the-environment");
    expect((await adultKeys(t.db)).replicate).toBe("r8_from-the-environment-ENVT");
    const saved = await (await settings({ replicate_key: "placeholder-replicate-RPLC" }, cookie)).json();
    expect(saved.settings).toMatchObject({ replicate_last4: "RPLC", replicate_from_env: false });
    expect(JSON.stringify(saved)).not.toContain("from-the-environment");
    expect((await adultKeys(t.db)).replicate).toBe("placeholder-replicate-RPLC");
  });
});

describe("pictures on Replicate", () => {
  it("makes the baselines on Replicate with its checker off, and stores only what passes Hive", async () => {
    const { cookie } = await admin();
    await settings({ image_provider: "venice", media_provider: "replicate", hive_key: "placeholder-hive" }, cookie);
    vi.stubEnv("REPLICATE_API_TOKEN", "r8_env");
    const venice: string[] = [];
    setMediaFetchForTests(async (input: RequestInfo | URL) => {
      venice.push(String(input));
      return new Response("unexpected", { status: 500 });
    });
    const replicate = fakeReplicate();
    const checks = fakeHive();
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Come here." }], explicit: true, picture: null }));
    const r = await (await call(POST, "/api/admin/after-dark", { a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.pictures.map((p: { kind: string }) => p.kind)).toEqual(["baseline", "baseline"]);
    expect(venice).toEqual([]);
    const made = replicate.creates("qwen/qwen-image");
    expect(made).toHaveLength(2);
    for (const m of made) {
      expect(m.headers.authorization).toBe("Bearer r8_env");
      expect(m.body!.input).toMatchObject({ aspect_ratio: "3:4", output_format: "png", disable_safety_checker: true, negative_prompt: expect.stringMatching(/minor/) });
      expect(String((m.body!.input as { prompt: string }).prompt)).toMatch(/adult/);
    }
    // Each picture's bytes went to Hive (moderation and the age check) before it was kept, and no Replicate URL is kept.
    expect(checks.filter((c) => c.kind === "moderation" && c.base64)).toHaveLength(2);
    expect(checks.filter((c) => c.kind === "vlm")).toHaveLength(2);
    const rows = (await t.db.query<{ remote_url: string | null; mime: string }>(`select remote_url, mime from adult_images where kind = 'baseline'`)).rows;
    expect(rows).toEqual([
      { remote_url: null, mime: "image/png" },
      { remote_url: null, mime: "image/png" },
    ]);
  });

  it("throws away a picture Hive refuses, and runs an SDXL-style model by its version", async () => {
    const { cookie } = await admin();
    await settings({ image_provider: "venice", media_provider: "replicate", replicate_key: "placeholder-replicate-RPLC", hive_key: "placeholder-hive", replicate_picture_model: "adirik/realvisxl-v4.0:85a58cc71587cc27539b7c83eb1ce4aea02feedfb9a9fae0598cebc110a3d695" }, cookie);
    const replicate = fakeReplicate();
    fakeHive((n) => (n.vlmCall && n.vlm === 0 ? vlmSays('{"answer": "MINOR"}') : null));
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Come here." }], explicit: true, picture: null }));
    const r = await (await call(POST, "/api/admin/after-dark", { a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.pictures).toEqual([]);
    expect(r.picture_note).toMatch(/discarded by the output check \(age check: MINOR\)/);
    expect((await t.db.query(`select 1 from adult_images`)).rows).toHaveLength(0);
    expect((await t.db.query<{ reason: string }>(`select reason from adult_rejections`)).rows[0].reason).toMatch(/age check: MINOR/);
    const made = replicate.creates("85a58cc71587cc27539b7c83eb1ce4aea02feedfb9a9fae0598cebc110a3d695");
    expect(made[0].body!.input).toMatchObject({ width: 832, height: 1104, num_outputs: 1, disable_safety_checker: true });
    expect(made[0].body!.input).not.toHaveProperty("aspect_ratio");
  });
});

describe("the video of the night on Replicate", () => {
  const night = Array.from({ length: 12 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans closer* Line number ${i} says something rather vivid here.` }));
  async function ready(cookie: string, ownerId: string, extra: Record<string, unknown> = {}) {
    await settings({ enabled: true, openrouter_key: "placeholder-text-ABCD", replicate_key: "placeholder-replicate-RPLC", hive_key: "placeholder-hive", media_provider: "replicate", reel_shots: 3, ...extra }, cookie);
    for (const [pid, c] of [["base-a", CAST_A], ["base-b", CAST_B]]) {
      await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, ownerId, c, Buffer.from(PNG)]);
    }
    const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json()).scene;
    await t.db.query(`update adult_scenes set lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify(night)]);
    return scene as { id: string; a: { id: string }; b: { id: string } };
  }
  /** Venice: nothing should reach it while Replicate is the provider. */
  function noVenice() {
    const asked: string[] = [];
    setReelFetchForTests(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response("unexpected", { status: 500 });
    });
    return asked;
  }
  const make = (cookie: string) => call(reelPost, "/api/admin/after-dark/reel", { a: CAST_A, b: CAST_B }, cookie);
  const advance = async (id: string, cookie: string) => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${id}`, { headers: { cookie } }))).json()).reel as Reel;
  const mediaOf = (url: unknown) => String(url).match(/media\/([^?]+)/)?.[1];
  const threeShots = () => scripted(JSON.stringify({ shots: [2, 5, 9].map((line) => ({ line, frame: "", motion: "" })) }));
  const media = (id: string, cookie?: string) => mediaGet(new Request(`${BASE_URL}/api/admin/after-dark/media/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

  it("draws each keyframe and video on Replicate with its checker off, checks both with Hive before keeping them, and says each line beside its silent shot", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id, { replicate_video_lora: "https://huggingface.co/x/y/resolve/main/both.safetensors" });
    const venice = noVenice();
    const replicate = fakeReplicate();
    const checks = fakeHive();
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    expect(started.status).toBe("making");
    expect(started.shots.every((s) => s.provider === "replicate" && s.status === "queued" && s.model === VIDEO && /^p\d+$/.test(s.queue_id ?? ""))).toBe(true);

    // The keyframes: Qwen-Image-Edit, the two baselines (by signed link) as Pictures 1 and 2, checker off.
    const keyframes = replicate.creates(KEYFRAME);
    expect(keyframes).toHaveLength(3);
    const firstBase = scene.a.id === CAST_A ? "base-a" : "base-b";
    for (const k of keyframes) {
      expect(k.headers).toMatchObject({ authorization: "Bearer placeholder-replicate-RPLC", prefer: "wait=60" });
      expect(k.body!.input).toMatchObject({ aspect_ratio: "3:4", output_format: "png", go_fast: true, disable_safety_checker: true });
      const images = (k.body!.input as { image: string[] }).image;
      expect(images.map(mediaOf)).toEqual([firstBase, firstBase === "base-a" ? "base-b" : "base-a"]);
      expect(String((k.body!.input as { prompt: string }).prompt)).toMatch(/^Make one photograph of the (man|woman) from Picture 1 and the (man|woman) from Picture 2 together\./);
      expect(String((k.body!.input as { prompt: string }).prompt)).not.toMatch(/Rafe|Juniper|Calloway|Vale/);
    }
    // Every keyframe passed Hive (moderation and the age check) on its bytes before it was kept as a 'frame'.
    expect(checks.filter((c) => c.kind === "vlm")).toHaveLength(3);
    const frames = (await t.db.query<{ id: string }>(`select id from adult_images where kind = 'frame'`)).rows.map((r) => r.id);
    expect(frames).toHaveLength(3);

    // The videos: Wan 2.2 from each kept keyframe, long enough for the line, the LoRA on both transformers, checker off.
    const videos = replicate.creates(VIDEO);
    expect(videos).toHaveLength(3);
    for (const v of videos) {
      expect(v.headers).toMatchObject({ "cancel-after": "30m" });
      expect(v.headers.prefer).toBeUndefined();
      expect(v.body!.input).toMatchObject({
        resolution: "720p",
        frames_per_second: 16,
        // "Line number 2 says something rather vivid here.": eight words, under the five seconds of 81 frames.
        num_frames: 81,
        go_fast: true,
        disable_safety_checker: true,
        lora_weights_transformer: "https://huggingface.co/x/y/resolve/main/both.safetensors",
        lora_weights_transformer_2: "https://huggingface.co/x/y/resolve/main/both.safetensors",
      });
      expect(String((v.body!.input as { prompt: string }).prompt)).toMatch(/The (man|woman) is the one speaking, lips moving with the words\.$/);
      expect(v.body!.input).not.toHaveProperty("negative_prompt");
    }
    expect(videos.map((v) => mediaOf((v.body!.input as { image: string }).image)).sort()).toEqual([...frames].sort());

    // First poll: still being made. Second: two in (Hive rate-limits a burst), each checked, kept, and voiced.
    const waiting = await advance(started.id, cookie);
    expect(waiting.shots.every((s) => s.status === "queued")).toBe(true);
    const two = await advance(started.id, cookie);
    expect(two.shots.filter((s) => s.status === "ready")).toHaveLength(2);
    const done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    expect(done.shots.every((s) => s.status === "ready" && s.media_id && s.audio_id)).toBe(true);
    // Each shot went to Hive (moderation only: its keyframe already passed the age check) before it was stored.
    expect(checks.filter((c) => c.kind === "moderation")).toHaveLength(6);
    expect(checks.filter((c) => c.kind === "vlm")).toHaveLength(3);

    // The voices: Kokoro by its version, each one's stock voice, the line itself; stored as audio beside the shot.
    const voices = replicate.creates(VOICE_VERSION);
    expect(voices).toHaveLength(3);
    const line2 = done.shots.find((s) => s.line === 2)!;
    const said = voices.find((v) => (v.body!.input as { text: string }).text === line2.text)!;
    expect(said.body!.input).toEqual({ text: "Line number 2 says something rather vivid here.", voice: replicateVoice(voiceFor((await loadCharacter(t.db, scene.a.id))!)), speed: 1 });
    const audio = (await t.db.query<{ id: string; mime: string; source_image: string; character_id: string; character_b: string }>(`select id, mime, source_image, character_id, character_b from adult_images where kind = 'audio'`)).rows;
    expect(audio).toHaveLength(3);
    expect(audio.every((a) => a.mime === "audio/wav")).toBe(true);
    for (const s of done.shots) expect(audio.find((a) => a.id === s.audio_id)?.source_image).toBe(s.media_id);
    const videoRows = (await t.db.query<{ source_image: string }>(`select source_image from adult_images where kind = 'video'`)).rows;
    expect(videoRows.map((v) => v.source_image).sort()).toEqual([...frames].sort());

    // The voice comes back with its shot, to an admin only, and stays out of the gallery.
    const listed = (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json()).reels as Reel[];
    expect(listed[0].shots.map((s) => s.audio_id)).toEqual(done.shots.map((s) => s.audio_id));
    const heard = await media(line2.audio_id!, cookie);
    expect(heard.status).toBe(200);
    expect(heard.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await heard.arrayBuffer())).toEqual(Buffer.from(WAV));
    expect((await media(line2.audio_id!)).status).toBe(404);
    const gallery = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json()).gallery as { kind: string }[];
    expect(gallery.some((g) => g.kind === "audio" || g.kind === "frame")).toBe(false);
    expect(venice).toEqual([]);
  });

  it("never stores a keyframe or a shot Hive refuses, and makes no voice for a refused shot", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    noVenice();
    const replicate = fakeReplicate();
    // The first keyframe's age check says MINOR; then the first video shows a child signal.
    fakeHive((n) => (n.vlmCall && n.vlm === 0 ? vlmSays('{"answer": "MINOR"}') : !n.vlmCall && n.mod === 3 ? CHILD_MOD : null));
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    expect(started.shots.map((s) => s.status)).toEqual(["discarded", "queued", "queued"]);
    expect(replicate.creates(VIDEO)).toHaveLength(2);
    expect((await t.db.query(`select 1 from adult_images where kind = 'frame'`)).rows).toHaveLength(2);
    await advance(started.id, cookie);
    const done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    expect(done.shots.map((s) => s.status)).toEqual(["discarded", "discarded", "ready"]);
    expect(done.shots[1].reason).toMatch(/moderation: yes_child_present/);
    expect((await t.db.query(`select 1 from adult_images where kind = 'video'`)).rows).toHaveLength(1);
    expect(replicate.creates(VOICE_VERSION)).toHaveLength(1);
    expect((await t.db.query(`select 1 from adult_images where kind = 'audio'`)).rows).toHaveLength(1);
    const logged = (await t.db.query<{ reason: string }>(`select reason from adult_rejections where kind = 'reel' order by created_at`)).rows.map((r) => r.reason);
    expect(logged).toEqual([expect.stringMatching(/^keyframe: age check: MINOR/), expect.stringMatching(/^moderation: yes_child_present/)]);
  });

  it("says why when Replicate is out of credit, fails a shot whose video it no longer has, and keeps a shot whose voice didn't come", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    noVenice();
    fakeHive();
    fakeReplicate({ create: () => Response.json({ title: "Insufficient credit", detail: "You have insufficient credit to run this model." }, { status: 402 }) });
    threeShots();
    const broke = (await (await make(cookie)).json()).reel as Reel;
    expect(broke.status).toBe("failed");
    expect(broke.shots.every((s) => s.status === "failed" && /^Replicate 402/.test(s.reason ?? ""))).toBe(true);
    expect(reelFailureNote(broke.shots)).toMatch(/out of credit/);

    // Its video deleted (collected too late), and Kokoro refusing: the first fails, the others come silent.
    fakeReplicate({
      create: (model) => (model === VOICE_VERSION ? Response.json({ detail: "Kokoro is down" }, { status: 503 }) : null),
      done: (pid) => (pid === "p4" ? { status: "succeeded", output: null } : { status: "succeeded", output: `https://replicate.delivery/xe/${pid}/output.mp4` }),
    });
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    await advance(started.id, cookie);
    const done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    const gone = done.shots.find((s) => s.queue_id === "p4")!;
    expect(gone).toMatchObject({ status: "failed", reason: expect.stringMatching(/no longer has it/) });
    const silent = done.shots.filter((s) => s.status === "ready");
    expect(silent).toHaveLength(2);
    expect(silent.every((s) => !s.audio_id && /^no voice: Replicate 503/.test(s.reason ?? ""))).toBe(true);
    expect(reelFailureNote(done.shots)).toMatch(/an hour/);
  });

  it("stops a reel's videos still running on Replicate when its owner stops it", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    noVenice();
    fakeHive();
    const replicate = fakeReplicate();
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    const stopped = (await (await reelDelete(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${started.id}`, { method: "DELETE", headers: { cookie } }))).json()).reel as Reel;
    expect(stopped.status).toBe("failed");
    const cancelled = replicate.seen.filter((s) => s.method === "POST" && s.url.endsWith("/cancel")).map((s) => s.url.match(/predictions\/([^/]+)\/cancel/)![1]);
    expect(cancelled.sort()).toEqual(started.shots.map((s) => s.queue_id!).sort());
  });

  it("needs the Replicate key (saved or the server's) when Replicate is the provider, and sends a big set by its link", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    await settings({ replicate_key: "" }, cookie);
    noVenice();
    fakeHive();
    const replicate = fakeReplicate();
    threeShots();
    const refused = await make(cookie);
    expect(refused.status).toBe(409);
    expect((await refused.json()).message).toBe("Videos need the Replicate and Hive keys in After Dark's settings.");
    vi.stubEnv("REPLICATE_API_TOKEN", "r8_env");
    // A drawn set too big to send inline (over 256 KB): Replicate fetches it from the public set link instead.
    await t.db.query(`update adult_scenes set place = 'the boathouse', set_place = 'the boathouse'`);
    await t.db.query(`insert into place_sets (normalized, label, status, mime, data) values ($1, $2, 'ready', 'image/jpeg', $3)`, [normalizeScene("the boathouse"), "the boathouse", Buffer.alloc(300 * 1024, 1)]);
    threeShots();
    expect((await make(cookie)).status).toBe(200);
    const keyframes = replicate.creates(KEYFRAME);
    expect(keyframes).toHaveLength(3);
    for (const k of keyframes) {
      expect(k.headers.authorization).toBe("Bearer r8_env");
      expect((k.body!.input as { image: string[] }).image[2]).toBe(`${BASE_URL}/api/sets/boathouse`);
    }
  });

  it("leaves Venice exactly as it was when Venice is the provider", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { media_provider: "venice", venice_key: "placeholder-venice" });
    const replicate = fakeReplicate();
    fakeHive();
    const asked: { path: string; body: Record<string, unknown> }[] = [];
    let q = 0;
    setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("https://api.venice.ai/api/v1", "");
      const body = JSON.parse(String(init?.body ?? "{}"));
      asked.push({ path, body });
      if (path === "/image/multi-edit") return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
      if (path === "/video/queue") return Response.json({ model: body.model, queue_id: `q${++q}` });
      if (path === "/video/retrieve") return new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } });
      return new Response("?", { status: 500 });
    });
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    expect(started.shots.every((s) => s.provider === undefined && s.voice === undefined && /^q\d$/.test(s.queue_id ?? ""))).toBe(true);
    expect(asked.filter((a) => a.path === "/image/multi-edit").every((a) => a.body.modelId === "qwen-edit-uncensored" && a.body.safe_mode === false)).toBe(true);
    expect(asked.filter((a) => a.path === "/video/queue").every((a) => a.body.model === "wan-3-0-image-to-video" && a.body.audio === true && a.body.resolution === "720p")).toBe(true);
    await advance(started.id, cookie);
    const done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    expect(done.shots.every((s) => s.audio_id === undefined)).toBe(true);
    expect(replicate.seen).toEqual([]);
  });
});

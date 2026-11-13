import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/live-face/route";
import { POST as liveRoute } from "@/app/api/companion/[id]/live/route";
import { POST as openRoute } from "@/app/api/companion/route";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { setDeepgramFetchForTests } from "@/lib/companion-live";
import { makeFaceKit } from "@/lib/face-kit";
import { buildLiveFace, collectLiveFaces, liveFaceMode, liveFaceOn, liveFaceSession, liveFaceState } from "@/lib/live-face";
import { createSimliFace, mintSimliSession, setSimliFetchForTests, SIMLI_API, simliFaceStatus } from "@/lib/live-face/simli";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { grantPlan } from "@/lib/paid-plans";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// A character's live face (lib/live-face; docs/PRDs/digital-human.md Tier 1): built at Simli (faked) from the kit's
// portrait, followed until ready, and a session minted for a call when it's on for the person.
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
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("REPLICATE_API_TOKEN", "placeholder-replicate");
  vi.stubEnv("DEEPGRAM_API_KEY", "placeholder-deepgram");
  vi.stubEnv("SIMLI_API_KEY", "placeholder-simli");
  vi.stubEnv("LIVE_FACE_PROVIDER", "simli");
  vi.stubEnv("COMPANION_LIVE", "");
  vi.stubEnv("COMPANION_OPEN", "1");
  setReplicatePausesForTests(false);
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setReplicateFetchForTests(null);
  setModerationFetchForTests(null);
  setSimliFetchForTests(null);
  setDeepgramFetchForTests(null);
  setReplicatePausesForTests(true);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const RAFE = HOUSE_CHARACTERS[0].id;

/** Replicate, faked, enough for a kit's stills (the loop stays queued; a kit needs only its portrait here). */
function fakeReplicate() {
  setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(".png")) return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (!init?.body) return Response.json({ id: "x", status: "processing" });
    if (url.includes("wan-video")) return Response.json({ id: "loop-1", status: "starting" });
    return Response.json({ id: "edit", status: "succeeded", output: "https://replicate.delivery/x/1.png" });
  });
  setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing: "CLOTHED", age: "ADULTS" }) } }] }));
}

/** Simli, faked: a face builds, its status goes as scripted, a session mints. What was asked is kept. */
function fakeSimli(script: { status?: string[]; outOfFaces?: boolean; listed?: string[] } = {}) {
  const asked: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const statuses = [...(script.status ?? ["pending", "processing", "completed"])];
  setSimliFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else if (init?.body instanceof FormData) body = { image: (init.body.get("image") as File | null)?.size ?? null, ratio: headers["target-ratio"] };
    asked.push({ url, method, headers, body });
    if (headers["x-simli-api-key"] !== "placeholder-simli") return Response.json({ detail: "bad key" }, { status: 401 });
    if (url.includes("/faces/trinity/preprocess")) {
      if (script.outOfFaces) return Response.json({ detail: "You have no Trinity-2 generations left." }, { status: 403 });
      return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png", "target-ratio": "1.25", warnings: "[]" } });
    }
    if (url.includes("/faces/trinity/generation_status")) {
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0];
      return Response.json({ status, queue_position: 0, generations: [{ face_id: "face-1", status, queue_position: 0 }] });
    }
    if (url.includes("/faces/trinity")) return Response.json({ message: "ok", face_id: "face-1", warnings: [] });
    if (url.endsWith("/faces")) return Response.json((script.listed ?? []).map((id) => ({ id, name: "x", is_owner: true, is_public: false, is_deleted: false, simli_version: 2, created_at: "", updated_at: "" })));
    if (url.endsWith("/compose/token")) return Response.json({ session_token: "sess-123", warnings: [] });
    return Response.json({ detail: "unknown" }, { status: 404 });
  });
  return asked;
}

async function withKit(owner: string = newUserCookie()): Promise<string> {
  const id = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), owner)).json()).id as string;
  await t.db.query(`insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'm', $3, 'approved', 'pg')`, [`asset-${id}`, id, "/cast/house-juniper-v3.webp"]);
  fakeReplicate();
  const made = await makeFaceKit(t.db, id, BASE_URL);
  if (!made.ok || made.made < 1) throw new Error("no kit");
  return id;
}
/** The status rows are polled only once a minute: pretend the last poll was long ago. */
const agePoll = () => t.db.query(`update live_faces set updated_at = now() - interval '2 minutes'`);

describe("live faces", () => {
  it("are off without the setting or the key, on for everyone with simli, and for admins alone with simli:admins", () => {
    expect(liveFaceMode({})).toBe("off");
    expect(liveFaceMode({ LIVE_FACE_PROVIDER: "simli" })).toBe("off");
    expect(liveFaceMode({ LIVE_FACE_PROVIDER: "simli", SIMLI_API_KEY: "k" })).toBe("on");
    expect(liveFaceMode({ LIVE_FACE_PROVIDER: "simli:admins", SIMLI_API_KEY: "k" })).toBe("admins");
    expect(liveFaceMode({ LIVE_FACE_PROVIDER: "tavus", SIMLI_API_KEY: "k" })).toBe("off");
    expect(liveFaceOn({ LIVE_FACE_PROVIDER: "simli:admins", SIMLI_API_KEY: "k" }, { admin: false })).toBe(false);
    expect(liveFaceOn({ LIVE_FACE_PROVIDER: "simli:admins", SIMLI_API_KEY: "k" }, { admin: true })).toBe(true);
  });

  it("talks to Simli as its docs say: the key in a header, the picture preprocessed then sent with its ratio, a status, a square session", async () => {
    const asked = fakeSimli();
    const made = await createSimliFace("placeholder-simli", { bytes: PNG, mime: "image/png" }, "botchelor Mara");
    expect(made).toEqual({ face_id: "face-1", dispatch_after: null, warnings: [] });
    expect(asked[0]).toMatchObject({ url: `${SIMLI_API}/faces/trinity/preprocess?gsVersion=GSA_2.0`, method: "POST", body: { image: PNG.length } });
    expect(asked[1]).toMatchObject({ url: `${SIMLI_API}/faces/trinity?gsVersion=GSA_2.0&face_name=botchelor%20Mara`, method: "POST", body: { image: PNG.length, ratio: "1.25" } });
    expect(await simliFaceStatus("placeholder-simli", "face-1")).toEqual({ status: "pending", queue_position: 0 });
    const s = await mintSimliSession("placeholder-simli", "face-1", { maxSeconds: 1800 });
    expect(s).toEqual({ token: "sess-123", warnings: [] });
    const token = asked.find((a) => a.url.endsWith("/compose/token"))!;
    expect(token.body).toMatchObject({ faceId: "face-1", audioInputFormat: "pcm16", handleSilence: true, maxSessionLength: 1800, streaming_width: 512, streaming_height: 512 });
    expect(token.headers["x-simli-api-key"]).toBe("placeholder-simli");
    await expect(mintSimliSession("wrong", "face-1")).rejects.toThrow(/401/);
  });

  it("is built from the kit's portrait, followed until Simli says it's done, and then gives a call its session", async () => {
    const id = await withKit();
    const asked = fakeSimli();
    expect(await liveFaceState(t.db, id, BASE_URL)).toBeNull();
    const r = await buildLiveFace(t.db, id, BASE_URL);
    expect(r).toEqual({ ok: true, face_id: "face-1", status: "making" });
    // The picture sent is the kit's own portrait (its bytes, not the ledger's file).
    expect(asked[0].body).toMatchObject({ image: PNG.length });
    expect(await liveFaceState(t.db, id, BASE_URL)).toMatchObject({ provider: "simli", provider_face_id: "face-1", status: "making" });
    // Built again? No: the one on its way stands.
    expect(await buildLiveFace(t.db, id, BASE_URL)).toEqual({ ok: true, face_id: "face-1", status: "making" });
    // Not ready: no session.
    expect(await liveFaceSession(t.db, id, BASE_URL, { admin: true })).toBeNull();
    // Followed: nothing asked within a minute of the last word; then pending, processing, and completed, a minute apart.
    expect(await collectLiveFaces(t.db, process.env, id)).toBe(0);
    await agePoll();
    expect(await collectLiveFaces(t.db, process.env, id)).toBe(0);
    await agePoll();
    expect(await collectLiveFaces(t.db, process.env, id)).toBe(0);
    await agePoll();
    expect(await collectLiveFaces(t.db, process.env, id)).toBe(1);
    expect(await liveFaceState(t.db, id, BASE_URL)).toMatchObject({ status: "ready" });
    const session = await liveFaceSession(t.db, id, BASE_URL, { admin: false }, { maxSeconds: 600 });
    expect(session).toEqual({ provider: "simli", token: "sess-123", px: 512 });
    // Admins only: a visitor gets none; off: nobody does.
    vi.stubEnv("LIVE_FACE_PROVIDER", "simli:admins");
    expect(await liveFaceSession(t.db, id, BASE_URL, { admin: false })).toBeNull();
    expect(await liveFaceSession(t.db, id, BASE_URL, { admin: true })).not.toBeNull();
    vi.stubEnv("LIVE_FACE_PROVIDER", "");
    expect(await liveFaceSession(t.db, id, BASE_URL, { admin: true })).toBeNull();
  });

  it("says why it can't: no kit yet, no generations left this month, Simli's build failed, Simli forgot it", async () => {
    const bare = (await (await api.createCharacter(validCharacter({ name: "No Kit" }), newUserCookie())).json()).id as string;
    fakeSimli();
    expect(await buildLiveFace(t.db, bare, BASE_URL)).toMatchObject({ ok: false, status: 409, error: "no_portrait" });
    expect(await buildLiveFace(t.db, RAFE, BASE_URL)).toMatchObject({ ok: false, status: 409, error: "no_kit" });
    const id = await withKit();
    fakeSimli({ outOfFaces: true });
    expect(await buildLiveFace(t.db, id, BASE_URL)).toMatchObject({ ok: false, status: 402, error: "no_generations" });
    expect(await liveFaceState(t.db, id, BASE_URL)).toBeNull();
    // A build that fails at Simli.
    fakeSimli({ status: ["failed"] });
    expect(await buildLiveFace(t.db, id, BASE_URL)).toMatchObject({ ok: true });
    await agePoll();
    await collectLiveFaces(t.db, process.env, id);
    expect(await liveFaceState(t.db, id, BASE_URL)).toMatchObject({ status: "failed", error: expect.stringMatching(/couldn't build/) });
    // A failed one can be asked for again; one Simli no longer tracks but lists is ready.
    fakeSimli({ status: ["not_found"], listed: ["face-1"] });
    expect(await buildLiveFace(t.db, id, BASE_URL)).toMatchObject({ ok: true, status: "making" });
    await agePoll();
    expect(await collectLiveFaces(t.db, process.env, id)).toBe(1);
    // Without the key nothing is built or followed.
    vi.stubEnv("SIMLI_API_KEY", "");
    expect(await buildLiveFace(t.db, id, BASE_URL)).toMatchObject({ ok: false, error: "not_set_up" });
    expect(await collectLiveFaces(t.db, process.env)).toBe(0);
  });

  it("gives a live call's start the face session when the face is ready, and none otherwise; the end keeps the face's seconds", async () => {
    const raw = newUserCookie();
    const me = userIdOf(raw);
    const id = await withKit(raw);
    fakeSimli({ status: ["completed"] });
    setDeepgramFetchForTests(async () => Response.json({ access_token: "dg-token", expires_in: 30 }));
    const cookie = `${signedInCookie(me)}; bz_adult=1`;
    await grantPlan(t.db, me, "companion", "initial", { subscriptionId: "sub_live_face" });
    const opened = (await (await openRoute(new Request(`${BASE_URL}/api/companion`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ character_id: id }) }))).json()) as { thread_id: string };
    const live = (body: unknown) => liveRoute(new Request(`${BASE_URL}/api/companion/${opened.thread_id}/live`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: opened.thread_id }) });
    // No face yet: the start answers face: null, and the call goes on.
    const first = await live({ action: "start" });
    let r = (await first.json()) as { call: { id: string }; face: unknown };
    expect([first.status, r]).toMatchObject([200, { face: null }]);
    // The face, built and done.
    expect(await buildLiveFace(t.db, id, BASE_URL)).toMatchObject({ ok: true });
    await agePoll();
    expect(await collectLiveFaces(t.db, process.env, id)).toBe(1);
    r = (await (await live({ action: "start" })).json()) as { call: { id: string }; face: unknown };
    expect(r.face).toEqual({ provider: "simli", token: "sess-123", px: 512 });
    const end = await live({ action: "end", call_id: r.call.id, seconds: 90, face: "simli", face_seconds: 75 });
    expect(end.status).toBe(200);
    expect((await t.db.query<{ face_provider: string; face_seconds: number }>(`select face_provider, face_seconds from companion_live_calls where id = $1`, [r.call.id])).rows[0]).toEqual({ face_provider: "simli", face_seconds: 75 });
  });

  it("is an admin's to build and read; the admin route answers Simli's refusals by status", async () => {
    const id = await withKit();
    fakeSimli({ status: ["processing"] });
    const post = (cookie: string | undefined, body: unknown) => adminPost(new Request(`${BASE_URL}/api/admin/live-face`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
    expect((await post(undefined, { character_id: id })).status).toBe(404);
    const someone = userIdOf(newUserCookie());
    await claimAdmin(t.db, someone);
    const admin = signedInCookie(someone);
    const r = await post(admin, { character_id: id });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ face_id: "face-1", status: "making" });
    const g = await adminGet(new Request(`${BASE_URL}/api/admin/live-face?character=${id}`, { headers: { cookie: admin } }));
    expect(await g.json()).toMatchObject({ mode: "on", face: { provider: "simli", face_id: "face-1", status: "making" } });
    expect((await post(admin, { character_id: id, action: "drop" })).status).toBe(200);
    expect(await liveFaceState(t.db, id, BASE_URL)).toBeNull();
    fakeSimli({ outOfFaces: true });
    expect((await post(admin, { character_id: id })).status).toBe(402);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as introGet } from "@/app/api/cast-intro/[id]/[file]/route";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/cast-intros/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { INTRO_MAX_CHARS, INTRO_RENDERER, introLineFor, introOf, introPortraitUrl, renderIntro, renderShowIntros, showIntros } from "@/lib/cast-intros";
import { setDeepgramFetchForTests } from "@/lib/companion-live";
import { LIVE_AUDIO_RATE } from "@/lib/companion-live-shared";
import { FAL_QUEUE, setRendererFetchForTests } from "@/lib/live-face/renderers";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// Cast video intros (lib/cast-intros.ts): the line from the bio, voiced by Aura (faked), rendered by OmniHuman on fal
// (faked) from the approved portrait, kept and served; the admin route renders one or the show's cast.
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
  vi.stubEnv("DEEPGRAM_API_KEY", "placeholder-deepgram");
  await saveAdultSettings(t.db, { fal_key: "placeholder-fal" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setRendererFetchForTests(null);
  setDeepgramFetchForTests(null);
  setSeasonCastForTests(null);
});

const MP4 = Buffer.from("ftypisom-not-really-an-mp4");

/** A WAV of `seconds` of silence at the call's rate (a 44-byte header, as Aura writes it). */
function wavOf(seconds: number): Buffer {
  const pcm = Buffer.alloc(Math.round(seconds * LIVE_AUDIO_RATE) * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(LIVE_AUDIO_RATE, 24);
  header.writeUInt32LE(LIVE_AUDIO_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Aura, faked: any line is `seconds` of voice. Keeps what was asked. */
function fakeAura(seconds = 6) {
  const asked: string[] = [];
  setDeepgramFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    asked.push(typeof init?.body === "string" ? ((JSON.parse(init.body) as { text?: string }).text ?? "") : "");
    return new Response(new Uint8Array(wavOf(seconds)), { headers: { "content-type": "audio/wav" } });
  });
  return asked;
}

/** fal, faked: OmniHuman's queue answers a clip; what it was sent is kept. */
function fakeFal(opts: { fail?: boolean } = {}) {
  const asked: { url: string; body?: Record<string, unknown> }[] = [];
  let polls = 0;
  setRendererFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    asked.push({ url, body });
    if (url === "https://cdn.fal/intro.mp4") return new Response(new Uint8Array(MP4));
    if (new Headers(init?.headers).get("authorization") !== "Key placeholder-fal") return Response.json({ detail: "Authentication is required" }, { status: 401 });
    if (url === `${FAL_QUEUE}/fal-ai/bytedance/omnihuman` && init?.method === "POST") {
      if (opts.fail) return Response.json({ detail: "content refused" }, { status: 422 });
      return Response.json({ request_id: "req-9", status_url: `${FAL_QUEUE}/fal-ai/bytedance/requests/req-9/status`, response_url: `${FAL_QUEUE}/fal-ai/bytedance/requests/req-9` });
    }
    if (url.endsWith("/requests/req-9/status")) return Response.json({ status: ++polls < 2 ? "IN_PROGRESS" : "COMPLETED" });
    if (url.endsWith("/requests/req-9")) return Response.json({ video: { url: "https://cdn.fal/intro.mp4" } });
    return Response.json({ detail: "unknown" }, { status: 404 });
  });
  return asked;
}

/** A character of someone's with an approved PG portrait asset. */
async function withPortrait(owner = newUserCookie(), name = "Mara Quill"): Promise<string> {
  const id = (await (await api.createCharacter(validCharacter({ name }), owner)).json()).id as string;
  await t.db.query(`insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'm', $3, 'approved', 'pg')`, [`asset-${id}`, id, "/cast/house-juniper-v3.webp"]);
  return id;
}

describe("the intro line", () => {
  it("is their name and the start of their bio, whole sentences, never longer than the limit, and not their name twice", () => {
    expect(introLineFor({ name: "Juniper Vale", bio: "Lighthouse keeper on a rock the gulls own. I name the drafts." })).toBe("Hi, I'm Juniper. Lighthouse keeper on a rock the gulls own. I name the drafts.");
    expect(introLineFor({ name: "Dex Moreno", bio: "Hey, I'm Dex. I throw pots that almost hold their shape." })).toBe("Hey, I'm Dex. I throw pots that almost hold their shape.");
    const long = introLineFor({ name: "Ada", bio: `${"A very long first sentence that keeps going and going well past any sensible length for a hello and then some more words".repeat(2)}. Short second.` });
    expect(long.length).toBeLessThanOrEqual(INTRO_MAX_CHARS);
    expect(long.startsWith("Hi, I'm Ada. ")).toBe(true);
    expect(long.endsWith(".")).toBe(true);
  });
});

describe("a cast intro", () => {
  it("voices the line, sends OmniHuman the approved portrait and the voiced line's public URL, keeps and serves the clip", async () => {
    const id = await withPortrait();
    const aura = fakeAura(6);
    const fal = fakeFal();
    expect(await introOf(t.db, id)).toBeNull();
    expect(await introPortraitUrl(t.db, id, BASE_URL)).toBe(`${BASE_URL}/api/assets/asset-${id}`);
    const r = await renderIntro(t.db, id, BASE_URL);
    expect(r).toMatchObject({ ok: true, status: "ready", seconds: 6, cost_usd: 0.84 });
    expect(aura[0]).toMatch(/^Hi, I'm Mara\./);
    const submit = fal.find((a) => a.url === `${FAL_QUEUE}/fal-ai/bytedance/omnihuman`)!;
    expect(submit.body).toMatchObject({ image_url: `${BASE_URL}/api/assets/asset-${id}` });
    expect(String(submit.body?.audio_url)).toMatch(new RegExp(`^${BASE_URL}/api/cast-intro/[0-9a-f-]+/audio\\.wav$`));
    const intro = (await introOf(t.db, id))!;
    expect(intro.url).toMatch(/^\/api\/cast-intro\/[0-9a-f-]+\/intro\.mp4\?v=\d+$/);
    expect(intro.line).toMatch(/^Hi, I'm Mara\./);
    const served = await introGet(new Request(`${BASE_URL}${intro.url}`), { params: Promise.resolve({ id: intro.id, file: "intro.mp4" }) });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("video/mp4");
    const audio = await introGet(new Request(`${BASE_URL}/api/cast-intro/${intro.id}/audio.wav`), { params: Promise.resolve({ id: intro.id, file: "audio.wav" }) });
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect((await introGet(new Request(`${BASE_URL}/api/cast-intro/${intro.id}/other`), { params: Promise.resolve({ id: intro.id, file: "other" }) })).status).toBe(404);
    // A re-render keeps the id but gets a new URL, so the year-long cache fetches the new clip.
    await t.db.query(`update character_intros set updated_at = updated_at + interval '1 hour' where id = $1`, [intro.id]);
    const again = (await introOf(t.db, id))!;
    expect(again.id).toBe(intro.id);
    expect(again.url).not.toBe(intro.url);
    // A ready intro isn't rendered again.
    const before = fal.length;
    expect(await renderIntro(t.db, id, BASE_URL)).toMatchObject({ ok: true, status: "ready" });
    expect(fal.length).toBe(before);
  });

  it("says why it can't: no portrait, no house key, the renderer refusing; a failed one can be asked for again", async () => {
    const bare = (await (await api.createCharacter(validCharacter({ name: "Bare" }), newUserCookie())).json()).id as string;
    fakeAura();
    fakeFal();
    expect(await renderIntro(t.db, bare, BASE_URL)).toMatchObject({ ok: false, status: 409, error: "no_portrait" });
    const id = await withPortrait();
    await saveAdultSettings(t.db, { fal_key: "" });
    expect(await renderIntro(t.db, id, BASE_URL)).toMatchObject({ ok: false, status: 409, error: "no_key" });
    await saveAdultSettings(t.db, { fal_key: "placeholder-fal" });
    fakeFal({ fail: true });
    expect(await renderIntro(t.db, id, BASE_URL)).toMatchObject({ ok: false, status: 502, error: "render_failed" });
    expect((await t.db.query<{ status: string }>(`select status from character_intros where character_id = $1`, [id])).rows[0].status).toBe("failed");
    fakeFal();
    expect(await renderIntro(t.db, id, BASE_URL)).toMatchObject({ ok: true, status: "ready" });
  });

  it("renders the show's cast that lacks one, lists them, and the admin route guards both", async () => {
    const a = await withPortrait(newUserCookie(), "Ada Finch");
    const b = await withPortrait(newUserCookie(), "Bo Reyes");
    setSeasonCastForTests([a, b]);
    fakeAura(5);
    const fal = fakeFal();
    const r = await renderShowIntros(t.db, BASE_URL);
    expect(r).toEqual({ made: [a, b], skipped: [], failed: [] });
    expect(fal.filter((x) => x.url === `${FAL_QUEUE}/fal-ai/bytedance/omnihuman`).length).toBe(2);
    expect(await renderShowIntros(t.db, BASE_URL)).toEqual({ made: [], skipped: [a, b], failed: [] });
    const listed = await showIntros(t.db);
    expect(listed.map((x) => [x.character_id, x.intro?.status])).toEqual([
      [a, "ready"],
      [b, "ready"],
    ]);
    // The admin route: strangers see nothing; an admin reads the list and may start renders (in the background here, a no-op).
    const stranger = await adminGet(new Request(`${BASE_URL}/api/admin/cast-intros`, { headers: { cookie: signedInCookie(userIdOf(newUserCookie())) } }));
    expect(stranger.status).toBe(404);
    const raw = newUserCookie();
    const admin = userIdOf(raw);
    await claimAdmin(t.db, admin);
    const cookie = signedInCookie(admin);
    const got = (await (await adminGet(new Request(`${BASE_URL}/api/admin/cast-intros`, { headers: { cookie } }))).json()) as { renderer: string; intros: unknown[] };
    expect(got.renderer).toBe(INTRO_RENDERER);
    expect(got.intros.length).toBe(2);
    const started = await adminPost(new Request(`${BASE_URL}/api/admin/cast-intros`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({}) }));
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual({ started: [], renderer: INTRO_RENDERER });
  });
});

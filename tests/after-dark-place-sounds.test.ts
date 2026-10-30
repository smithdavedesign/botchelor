import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as soundGet } from "@/app/api/admin/after-dark/place-sound/route";
import { GET as soundFileGet } from "@/app/api/admin/after-dark/place-sound/[id]/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { DAILY_NEW, placeSound, setPlaceSoundFetchForTests, soundPlace, soundPrompt } from "@/lib/adult/place-sounds";
import { claimAdmin } from "@/lib/admins";
import { sessionCookies } from "@/lib/http";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The sound of a place (lib/adult/place-sounds.ts; docs/PRDs/theater-immersion.md #6): no live calls here.
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
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setPlaceSoundFetchForTests(null);
});

const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
async function admin(settings: Record<string, unknown> = {}) {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  const cookie = signedIn(id);
  await settingsPost(
    new Request(`${BASE_URL}/api/admin/after-dark/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", ...settings }),
    }),
  );
  return { id, cookie };
}
const MP3 = new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2]);
/** Venice's audio queue: a queue id, then still processing until `done()`, then the MP3. Records what was asked. */
function fakeVenice(done: () => boolean = () => true) {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  setPlaceSoundFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ path, body });
    if (path === "/audio/queue") return Response.json({ model: body.model, queue_id: `aq-${seen.length}` });
    if (path === "/audio/retrieve") return done() ? new Response(MP3, { headers: { "content-type": "audio/mpeg" } }) : Response.json({ status: "PROCESSING" });
    return new Response("?", { status: 500 });
  });
  return seen;
}

describe("the sound of a place", () => {
  it("is keyed by the stage's place: a library venue by its id, anywhere else by its words", () => {
    expect(soundPlace("jazz_bar")).toEqual({ key: "venue:jazz_bar", label: expect.any(String) });
    expect(soundPlace("elsewhere@The rooftop garden")).toEqual({ key: "place:rooftop garden", label: "The rooftop garden" });
    expect(soundPlace("elsewhere@rooftop garden")?.key).toBe("place:rooftop garden");
    expect(soundPlace(null)).toBeNull();
    expect(soundPrompt("a jazz bar")).toMatch(/^The ambient sound of a jazz bar, heard from inside/);
    expect(soundPrompt("a jazz bar")).toMatch(/No voices, no speech/);
  });

  it("is started once for a place with none, as a seamless loop, collected when Venice has it, and then reused", async () => {
    await admin();
    let ready = false;
    const seen = fakeVenice(() => ready);
    expect(await placeSound(t.db, "elsewhere@a rainy rooftop")).toEqual({ status: "making" });
    const queued = seen.find((s) => s.path === "/audio/queue")!;
    expect(queued.body).toMatchObject({ model: "elevenlabs-sound-effects-v2", duration_seconds: 20, loop: true, prompt: soundPrompt("a rainy rooftop") });
    // Asked again while it's being made: no second queue, still making.
    expect(await placeSound(t.db, "elsewhere@A rainy rooftop!")).toEqual({ status: "making" });
    expect(seen.filter((s) => s.path === "/audio/queue")).toHaveLength(1);
    ready = true;
    const got = await placeSound(t.db, "elsewhere@a rainy rooftop");
    expect(got.status).toBe("ready");
    // Venice's copy is let go once ours is kept, and the next ask costs nothing.
    expect(seen.at(-1)!.body).toMatchObject({ delete_media_on_completion: true });
    seen.length = 0;
    expect(await placeSound(t.db, "elsewhere@a rainy rooftop")).toEqual(got);
    expect(seen).toHaveLength(0);
  });

  it("is off when switched off, and starts no more than the day's new places", async () => {
    await admin({ place_sounds: false });
    fakeVenice();
    expect(await placeSound(t.db, "jazz_bar")).toEqual({ status: "off" });
    await admin({ place_sounds: true });
    for (let i = 0; i < DAILY_NEW; i++) await t.db.query(`insert into place_sounds (id, key, label, status) values ($1, $2, 'x', 'ready')`, [`s${i}`, `place:p${i}`]);
    expect(await placeSound(t.db, "jazz_bar")).toMatchObject({ status: "none", reason: "today's new places are used up" });
  });

  it("keeps why it failed, and doesn't ask again for a while", async () => {
    await admin();
    setPlaceSoundFetchForTests(async () => new Response("Insufficient USD or Diem balance", { status: 402 }));
    expect(await placeSound(t.db, "jazz_bar")).toMatchObject({ status: "failed", reason: expect.stringMatching(/^Venice 402/) });
    const seen = fakeVenice();
    expect(await placeSound(t.db, "jazz_bar")).toEqual({ status: "failed" });
    expect(seen).toHaveLength(0);
  });
});

describe("the place-sound routes", () => {
  it("are After Dark's viewers' only, and serve a ready sound", async () => {
    const { cookie } = await admin();
    fakeVenice();
    expect((await soundGet(new Request(`${BASE_URL}/api/admin/after-dark/place-sound?venue=jazz_bar`))).status).toBe(404);
    expect(await (await soundGet(new Request(`${BASE_URL}/api/admin/after-dark/place-sound?venue=jazz_bar`, { headers: { cookie } }))).json()).toEqual({ status: "making" });
    const ready = (await (await soundGet(new Request(`${BASE_URL}/api/admin/after-dark/place-sound?venue=jazz_bar`, { headers: { cookie } }))).json()) as { status: string; id: string };
    expect(ready.status).toBe("ready");
    const file = await soundFileGet(new Request(`${BASE_URL}/api/admin/after-dark/place-sound/${ready.id}`, { headers: { cookie } }), { params: Promise.resolve({ id: ready.id }) });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("audio/mpeg");
    const visitor = await soundFileGet(new Request(`${BASE_URL}/api/admin/after-dark/place-sound/${ready.id}`), { params: Promise.resolve({ id: ready.id }) });
    expect(visitor.status).toBe(404);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { GET as mediaGet } from "@/app/api/admin/after-dark/media/[id]/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { POST as voicePost } from "@/app/api/admin/after-dark/voice/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { replicateVoice, voiceFor } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { DEFAULT_REPLICATE_VOICE_MODEL } from "@/lib/adult/settings";
import { modelVoice, sayable, setVoiceFetchForTests, VOICE_BATCH_MAX, voiceKey } from "@/lib/adult/voice-lines";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Voiced nights (lib/adult/voice-lines.ts; David 2026-10-22): no live calls here.
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
  setReplicatePausesForTests(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setVoiceFetchForTests(null);
  setReplicateFetchForTests(null);
  setReplicatePausesForTests(true);
});

// Rafe (he) and Juniper (she); the pair is stored lower id first, so "a" is Juniper.
const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const MP3 = new Uint8Array([73, 68, 51, 4, 0, 0]);
const LINES = [
  { who: "a", text: "*smiles* You kept me waiting by the railing." },
  { who: "b", text: "Seven boats? I'll make it up to you with terrible tea." },
  { who: "a", text: "*laughs and pours two cups*" },
  { who: "b", text: "Then I'm staying *grins* for the crime." },
  { who: "a", text: "Tell me what you see out there." },
];
/** Kokoro on Venice: an MP3 for whatever it's asked; records the asks. */
function fakeKokoro(fail = false) {
  const asked: Record<string, unknown>[] = [];
  setVoiceFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://api.venice.ai/api/v1/audio/speech");
    asked.push(JSON.parse(String(init?.body)));
    return fail ? new Response("Insufficient USD or Diem balance", { status: 402 }) : new Response(MP3, { headers: { "content-type": "audio/mpeg" } });
  });
  return asked;
}
async function ready(cookie: string, lines: unknown[] = LINES, settings: Record<string, unknown> = {}) {
  await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", ...settings }, cookie);
  const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene as { id: string };
  await t.db.query(`update adult_scenes set lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify(lines)]);
  return scene;
}
const voice = (cookie: string, lines: { i: number; text: string }[], extra: Record<string, unknown> = {}) =>
  call(voicePost, "/api/admin/after-dark/voice", { a: RAFE, b: JUNIPER, lines, ...extra }, cookie);
const ask = (...is: number[]) => is.map((i) => ({ i, text: LINES[i].text }));
const voices = async (res: Response) => (await res.json()).voices as { i: number; id: string | null; reason?: string; message?: string }[];

describe("a line's voice", () => {
  it("says only what a line says, in its character's stock voice, and keeps it: a replay asks Kokoro for nothing", async () => {
    const { id, cookie } = await admin();
    await ready(cookie);
    const asked = fakeKokoro();
    const first = await voices(await voice(cookie, ask(0, 1, 2)));
    expect(first.map((v) => [v.i, Boolean(v.id), v.reason])).toEqual([
      [0, true, undefined],
      [1, true, undefined],
      [2, false, "silent"],
    ]);
    const [juniper, rafe] = [(await loadCharacter(t.db, JUNIPER))!, (await loadCharacter(t.db, RAFE))!];
    expect(asked).toEqual([
      { model: "tts-kokoro", input: "You kept me waiting by the railing.", voice: voiceFor(juniper), response_format: "mp3" },
      { model: "tts-kokoro", input: "Seven boats? I'll make it up to you with terrible tea.", voice: voiceFor(rafe), response_format: "mp3" },
    ]);
    // Kept as an 'audio' of the speaker with the other, out of the gallery, and served to its owner.
    const row = (await t.db.query<{ kind: string; character_id: string; character_b: string; mime: string }>(`select kind, character_id, character_b, mime from adult_images where id = $1`, [first[0].id])).rows[0];
    expect(row).toEqual({ kind: "audio", character_id: JUNIPER, character_b: RAFE, mime: "audio/mpeg" });
    const served = await mediaGet(new Request(`${BASE_URL}/api/admin/after-dark/media/${first[0].id}`, { headers: { cookie } }), { params: Promise.resolve({ id: first[0].id! }) });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("audio/mpeg");
    // Again: the same audio, no new call, not counted again.
    asked.length = 0;
    const again = await voices(await voice(cookie, ask(1, 0)));
    expect(again.map((v) => v.id)).toEqual([first[1].id, first[0].id]);
    expect(asked).toHaveLength(0);
    expect((await t.db.query<{ n: number }>(`select voice_lines as n from adult_usage where owner_id = $1`, [id])).rows[0].n).toBe(2);
    // Actions in the middle come out too.
    const mid = await voices(await voice(cookie, ask(3)));
    expect(mid[0].id).toBeTruthy();
    expect(asked[0].input).toBe("Then I'm staying for the crime.");
  });

  it("voices only the night's own lines, word for word, a few at a time, and never one that crosses the two lines", async () => {
    const { cookie } = await admin();
    await ready(cookie, [...LINES, { who: "b", text: "She's sixteen, you know." }]);
    const asked = fakeKokoro();
    const v = await voices(await voice(cookie, [{ i: 0, text: "Something else entirely." }, { i: 99, text: "Nope." }, { i: 5, text: "She's sixteen, you know." }]));
    expect(v.map((x) => x.reason)).toEqual(["stale", "stale", "lines"]);
    expect(asked).toHaveLength(0);
    expect((await voice(cookie, ask(0, 1, 3, 4))).status).toBe(422);
    expect(VOICE_BATCH_MAX).toBe(3);
    // Not found for anyone After Dark isn't open to.
    expect((await voice(signedIn(userIdOf(newUserCookie())), ask(0))).status).toBe(404);
  });

  it("voices a saved night's lines too", async () => {
    const { id, cookie } = await admin();
    await ready(cookie);
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, stage) values ('night-1', $1, $2, $3, $4::jsonb, 1)`, [
      id,
      JUNIPER,
      RAFE,
      JSON.stringify([{ who: "b", text: "*waves* The ferry's late again tonight." }]),
    ]);
    fakeKokoro();
    const v = await voices(await voice(cookie, [{ i: 0, text: "*waves* The ferry's late again tonight." }], { night_id: "night-1" }));
    expect(v[0].id).toBeTruthy();
    // Another owner's night isn't theirs.
    const other = await admin();
    await ready(other.cookie);
    expect((await voice(other.cookie, [{ i: 0, text: "*waves* The ferry's late again tonight." }], { night_id: "night-1" })).status).toBe(404);
  });

  it("stops making new voices at a subscriber's monthly cap, while replays still play; admins aren't capped", async () => {
    const { cookie: adminCookie } = await admin();
    await ready(adminCookie);
    await t.db.query(`update adult_settings set cap_voice_lines = 2`);
    const sub = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    const cookie = signedIn(sub);
    await ready(cookie);
    const asked = fakeKokoro();
    const v = await voices(await voice(cookie, ask(0, 1, 4)));
    expect(v.map((x) => x.reason)).toEqual([undefined, undefined, "cap"]);
    expect(v[2].message).toMatch(/You've used this month's 2 voiced lines/);
    expect(asked).toHaveLength(2);
    const replay = await voices(await voice(cookie, ask(0, 1)));
    expect(replay.every((x) => x.id)).toBe(true);
    expect(asked).toHaveLength(2);
    // The admin's own night isn't capped.
    expect((await voices(await voice(adminCookie, ask(0, 1, 4)))).every((x) => x.id)).toBe(true);
  });

  it("leaves a line silent when Kokoro fails, without counting it", async () => {
    const { id, cookie } = await admin();
    await ready(cookie);
    fakeKokoro(true);
    const v = await voices(await voice(cookie, ask(0)));
    expect(v[0]).toMatchObject({ id: null, reason: "failed" });
    expect(v[0].message).toMatch(/^Venice 402/);
    expect((await t.db.query(`select 1 from adult_voice_lines where owner_id = $1`, [id])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from adult_images where kind = 'audio'`)).rows).toHaveLength(0);
  });

  it("runs Kokoro on Replicate by its version when that's the media provider, af_heart as af_alloy", async () => {
    const { cookie } = await admin();
    await ready(cookie, LINES, { media_provider: "replicate", replicate_key: "placeholder-replicate-RPLC" });
    const seen: { url: string; body?: Record<string, unknown> }[] = [];
    setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith("https://replicate.delivery/")) return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "content-type": "audio/x-wav" } });
      return Response.json({ id: "k1", status: "succeeded", output: "https://replicate.delivery/xe/k1/output.wav" }, { status: 201 });
    });
    const v = await voices(await voice(cookie, ask(1)));
    expect(v[0].id).toBeTruthy();
    const rafe = (await loadCharacter(t.db, RAFE))!;
    expect(seen[0].url).toBe("https://api.replicate.com/v1/predictions");
    expect(seen[0].body).toEqual({ version: DEFAULT_REPLICATE_VOICE_MODEL.split(":")[1], input: { text: "Seven boats? I'll make it up to you with terrible tea.", voice: replicateVoice(voiceFor(rafe)), speed: 1 } });
    expect((await t.db.query<{ mime: string }>(`select mime from adult_images where id = $1`, [v[0].id])).rows[0].mime).toBe("audio/wav");
    expect(replicateVoice("af_heart")).toBe("af_alloy");
  });

  it("reads only what's said, and keys a line by its owner, voice and words", () => {
    expect(sayable("*smiles* Hello *waves* there.")).toBe("Hello there.");
    expect(sayable("*only an action*")).toBe("");
    expect(sayable("a stray * star")).toBe("a stray star");
    expect(voiceKey("o1", "af_bella", "Hi.")).not.toBe(voiceKey("o2", "af_bella", "Hi."));
    expect(voiceKey("o1", "af_bella", "Hi.")).not.toBe(voiceKey("o1", "af_nova", "Hi."));
    expect(voiceKey("o1", "af_bella", "Hi.")).toBe(voiceKey("o1", "af_bella", "Hi."));
  });
});

describe("a voice model (docs/PRDs/theater-immersion.md #3)", () => {
  it("makes the lines asked for at once, not one after another, so the one about to play isn't kept waiting", async () => {
    const { cookie } = await admin();
    await ready(cookie);
    let inFlight = 0;
    let most = 0;
    setVoiceFetchForTests(async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
      return new Response(MP3, { headers: { "content-type": "audio/mpeg" } });
    });
    const v = await voices(await voice(cookie, ask(0, 1, 3)));
    expect(v.map((x) => x.i)).toEqual([0, 1, 3]);
    expect(v.every((x) => x.id)).toBe(true);
    expect(most).toBe(3);
  });

  it("speaks each line in the settings' model, its own voice per character, with Orpheus's sounds; a line kept in Kokoro is voiced again", async () => {
    const { cookie } = await admin();
    const lines = [{ who: "a", text: "*laughs* You kept me waiting by the railing." }, ...LINES.slice(1)];
    await ready(cookie, lines);
    const asked = fakeKokoro();
    const kokoro = await voices(await voice(cookie, [{ i: 0, text: lines[0].text }]));
    expect(asked[0]).toMatchObject({ model: "tts-kokoro", input: "You kept me waiting by the railing." });
    await call(settingsPost, "/api/admin/after-dark/settings", { voice_model: "orpheus" }, cookie);
    asked.length = 0;
    const orpheus = await voices(await voice(cookie, [{ i: 0, text: lines[0].text }, { i: 1, text: lines[1].text }]));
    const [juniper, rafe] = [(await loadCharacter(t.db, JUNIPER))!, (await loadCharacter(t.db, RAFE))!];
    expect(asked).toEqual([
      { model: "tts-orpheus", input: "<laugh> You kept me waiting by the railing.", voice: modelVoice("orpheus", juniper).split(":")[1], response_format: "wav" },
      { model: "tts-orpheus", input: "Seven boats? I'll make it up to you with terrible tea.", voice: modelVoice("orpheus", rafe).split(":")[1], response_format: "wav" },
    ]);
    expect(orpheus[0].id).not.toBe(kokoro[0].id);
    // Kept as the WAV it is (only Kokoro gives MP3).
    expect((await t.db.query<{ mime: string }>(`select mime from adult_images where id = $1`, [orpheus[0].id])).rows[0].mime).toBe("audio/wav");
  });
});

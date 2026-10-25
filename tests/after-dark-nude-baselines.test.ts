import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { POST as facePost } from "@/app/api/admin/after-dark/face/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { attireOf } from "@/lib/adult/attire";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { baselinePrompt, ensureNudeBaseline, listMedia, setMediaFetchForTests } from "@/lib/adult/media";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { keepPictureOfBoth } from "@/lib/adult/pictures-menu";
import { baselines, reelCast, setReelFetchForTests, setReelPausesForTests, startShots, type Reel, type ReelShot } from "@/lib/adult/reels";
import { adultKeys, getAdultSettings } from "@/lib/adult/settings";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { faceReferenceId, facesFor, setFaceReference } from "@/lib/adult/steering";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Undressed moments start from nude baselines (David, 2026-10-24: "if we have our character set up with underwear, their
// sex scenes and baselines have it on no matter the situation … in sex scenes we need a new baseline"). No live calls.
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
  setReelFetchForTests(null);
  setReplicateFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
});

// Rafe (he) and Juniper (she); the pair is stored lower id first, so "a" is Juniper. Juniper wears something here.
const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
function fakeHive() {
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(String(input) === HIVE_VLM ? { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] } : CLEAN_MOD),
  );
}
/** Venice: pictures (each prompt kept), keyframes (each one's pictures kept), queues and a shot done at once. */
function fakeVenice() {
  const pictures: string[] = [];
  const edits: { images: string[]; prompt: string }[] = [];
  setMediaFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    pictures.push(String(JSON.parse(String(init?.body ?? "{}")).prompt));
    return Response.json({ images: [Buffer.from(PNG).toString("base64")] });
  });
  let q = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (path === "/image/multi-edit") {
      edits.push({ images: (body.images as string[]).map((u) => String(u).match(/media\/([^?]+)/)?.[1] ?? "?"), prompt: String(body.prompt) });
      return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    }
    if (path === "/video/queue") return Response.json({ model: body.model, queue_id: `q${++q}` });
    if (path === "/video/retrieve") return new Response(new Uint8Array([0, 0, 0, 24]), { headers: { "content-type": "video/mp4" } });
    return new Response("?", { status: 500 });
  });
  return { pictures, edits };
}
const DRESSED = "Uncensored adult photograph, a woman. Wearing a fitted white t-shirt and blue jeans, alone, waist-up, facing the camera, face clearly visible, natural light, photorealistic. Everyone shown is an adult.";
const NUDE = "Explicit, uncensored adult photograph, a man. Nude, alone, waist-up, facing the camera, face clearly visible, natural light, photorealistic. Everyone shown is an adult.";
/** A baseline straight into the table: `ago` minutes old, its prompt saying dressed or nude, its attire left unstored. */
async function baseline(id: string, owner: string, character: string, prompt: string, ago = 0) {
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, created_at) values ($1, $2, $3, 'baseline', $4, 'image/png', $5, now() - make_interval(mins => $6))`, [
    id,
    owner,
    character,
    prompt,
    Buffer.from(PNG),
    ago,
  ]);
}
/** Juniper's look with an outfit: her baseline is drawn in it, so she needs a nude one too. */
const dressJuniper = () => t.db.query(`update characters set extras = coalesce(extras, '{}'::jsonb) || $2::jsonb where id = $1`, [JUNIPER, JSON.stringify({ looks: { gender: "woman", outfit: "casual" } })]);
const setUp = (cookie: string) =>
  call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, image_provider: "venice", openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie);
/** After Dark on, the pair's scene at `stage`, Juniper dressed (her baseline in her outfit) and Rafe's baseline nude. */
async function ready(cookie: string, owner: string, stage: number) {
  await setUp(cookie);
  await dressJuniper();
  await baseline("base-juniper", owner, JUNIPER, DRESSED, 10);
  await baseline("base-rafe", owner, RAFE, NUDE, 10);
  const res = await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }));
  const scene = (await res.json()).scene as { id: string };
  const lines = Array.from({ length: 8 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans closer* Line number ${i} is said quite softly here.`, stage }));
  await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = $3, place = 'her bedroom', set_place = 'her bedroom' where id = $1`, [scene.id, JSON.stringify(lines), stage]);
}

describe("a nude baseline", () => {
  it("is the same look and framing without the outfit, and is stored as nude", async () => {
    await dressJuniper();
    const juniper = (await loadCharacter(t.db, JUNIPER))!;
    const dressed = baselinePrompt(juniper, null);
    const nude = baselinePrompt(juniper, null, "natural light", { nude: true });
    expect(dressed).toMatch(/^Uncensored adult photograph, .*\. Wearing a fitted white t-shirt and blue jeans, alone, waist-up, facing the camera, face clearly visible/);
    expect(nude).toMatch(/^Explicit, uncensored adult photograph, .*\. Nude, alone, waist-up, facing the camera, face clearly visible/);
    expect(nude).not.toMatch(/Wearing|t-shirt/);
    expect([attireOf("baseline", dressed), attireOf("baseline", nude), attireOf("scene", nude)]).toEqual(["dressed", "nude", null]);
  });

  it("is drawn the first time one's needed for a character who wears something, and never for one who doesn't", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await dressJuniper();
    fakeHive();
    const { pictures } = fakeVenice();
    await baseline("base-juniper", id, JUNIPER, DRESSED);
    await baseline("base-rafe", id, RAFE, NUDE);
    const [juniper, rafe] = [(await loadCharacter(t.db, JUNIPER))!, (await loadCharacter(t.db, RAFE))!];
    const made = (await ensureNudeBaseline(t.db, id, juniper))!;
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toMatch(/\. Nude, alone, waist-up/);
    expect((await t.db.query<{ attire: string }>(`select attire from adult_images where id = $1`, [made.id])).rows[0].attire).toBe("nude");
    // Rafe wears nothing: his baseline is nude already (read from its prompt). And Juniper has hers now.
    expect(await ensureNudeBaseline(t.db, id, rafe)).toBeNull();
    expect(await ensureNudeBaseline(t.db, id, juniper)).toBeNull();
    expect(pictures).toHaveLength(1);
    // The gallery says which is which.
    expect((await listMedia(t.db, [JUNIPER], id)).map((m) => [m.id === made.id ? "nude-one" : m.id, m.nude])).toEqual([
      ["nude-one", true],
      ["base-juniper", false],
    ]);
  });
});

describe("the face a moment starts from", () => {
  it("is a dressed baseline for a dressed moment, even when a nude one is newer, and only a nude one undressed", async () => {
    const { id } = await admin();
    await dressJuniper();
    await baseline("dressed-old", id, JUNIPER, DRESSED, 30);
    await baseline("nude-new", id, JUNIPER, NUDE, 5);
    expect(await faceReferenceId(t.db, id, JUNIPER)).toBe("dressed-old");
    expect(await faceReferenceId(t.db, id, JUNIPER, { nude: true })).toBe("nude-new");
    expect(await baselines(t.db, JUNIPER, RAFE, id, { nude: true })).toBeNull();
    // A face picked (dressed) is never the undressed one; a nude one picked is, and leaves the dressed face alone.
    expect(await setFaceReference(t.db, id, JUNIPER, "dressed-old")).toEqual({ ok: true, image_id: "dressed-old", nude: false });
    expect(await faceReferenceId(t.db, id, JUNIPER, { nude: true })).toBe("nude-new");
    await baseline("nude-liked", id, JUNIPER, NUDE, 20);
    expect(await setFaceReference(t.db, id, JUNIPER, "nude-liked")).toEqual({ ok: true, image_id: "nude-liked", nude: true });
    expect(await faceReferenceId(t.db, id, JUNIPER, { nude: true })).toBe("nude-liked");
    expect(await faceReferenceId(t.db, id, JUNIPER)).toBe("dressed-old");
    expect(await facesFor(t.db, id, [JUNIPER, RAFE])).toEqual({
      [JUNIPER]: { image_id: "dressed-old", picked: true, nude: { image_id: "nude-liked", picked: true } },
      [RAFE]: { image_id: null, picked: false, nude: null },
    });
    // Back to the default for the undressed face only: the one they picked keeps its 👍, so it still leads.
    expect(await setFaceReference(t.db, id, JUNIPER, null, [], { nude: true })).toEqual({ ok: true, image_id: "nude-liked", nude: true });
    expect((await t.db.query(`select 1 from adult_nude_refs`)).rows).toHaveLength(0);
    expect(await faceReferenceId(t.db, id, JUNIPER)).toBe("dressed-old");
  });

  it("for a character who wears nothing, a nude baseline picked is simply their face", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await baseline("rafe-1", id, RAFE, NUDE, 10);
    const res = await call(facePost, "/api/admin/after-dark/face", { character_id: RAFE, image_id: "rafe-1" }, cookie);
    expect(await res.json()).toEqual({ image_id: "rafe-1", nude: false });
    expect(await faceReferenceId(t.db, id, RAFE)).toBe("rafe-1");
    expect(await faceReferenceId(t.db, id, RAFE, { nude: true })).toBe("rafe-1");
  });
});

describe("pictures and videos at sex", () => {
  it("start a clip from the nude baselines, made first for the one who wears something; a kiss keeps them dressed", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, 4);
    fakeHive();
    const { pictures, edits } = fakeVenice();
    const res = await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, act: "on_top" }, cookie);
    expect(res.status).toBe(200);
    const clip = (await res.json()).reel as Reel;
    expect(clip.status).toBe("making");
    // Juniper's nude baseline was drawn first; Rafe's own baseline is nude already.
    expect(pictures).toHaveLength(1);
    const nudeJuniper = (await t.db.query<{ id: string }>(`select id from adult_images where character_id = $1 and attire = 'nude'`, [JUNIPER])).rows[0].id;
    expect(edits[0].images.slice(0, 2)).toEqual([nudeJuniper, "base-rafe"]);
  });

  it("keep a dressed moment on the dressed baseline", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, 2);
    fakeHive();
    const { pictures, edits } = fakeVenice();
    expect((await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, act: "kiss" }, cookie)).status).toBe(200);
    expect(pictures).toEqual([]);
    expect(edits[0].images.slice(0, 2)).toEqual(["base-juniper", "base-rafe"]);
  });

  it("draw a picture of both at sex (a menu or beat picture) from the nude baselines", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, 4);
    fakeHive();
    const { edits } = fakeVenice();
    const [ca, cb] = [(await loadCharacter(t.db, JUNIPER))!, (await loadCharacter(t.db, RAFE))!];
    const ctx = { keys: await adultKeys(t.db), settings: await getAdultSettings(t.db), baseUrl: BASE_URL, reject: async () => {} };
    const kept = await keepPictureOfBoth(t.db, id, [ca, cb], { place: null, stage: 4, promptFor: () => "Make one photograph of the woman from Picture 1 and the man from Picture 2 together. Both are adults." }, ctx);
    expect(kept.ok).toBe(true);
    const nudeJuniper = (await t.db.query<{ id: string }>(`select id from adult_images where character_id = $1 and attire = 'nude'`, [JUNIPER])).rows[0].id;
    expect(edits[0].images).toEqual([nudeJuniper, "base-rafe"]);
    // Undressing (stage 3) is still the dressed baseline: down to what they wear.
    await keepPictureOfBoth(t.db, id, [ca, cb], { place: null, stage: 3, promptFor: () => "Make one photograph of the woman from Picture 1 and the man from Picture 2 together. Both are adults." }, ctx);
    expect(edits[1].images).toEqual(["base-juniper", "base-rafe"]);
  });

  it("start each shot of a whole night from the faces of its own moment: dressed before sex, nude at it", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, 4);
    fakeHive();
    const { edits } = fakeVenice();
    await baseline("nude-juniper", id, JUNIPER, NUDE.replace("a man", "a woman"), 5);
    const [ca, cb] = [(await loadCharacter(t.db, JUNIPER))!, (await loadCharacter(t.db, RAFE))!];
    const shots: ReelShot[] = [0, 1].map((line) => ({ line, who: "a", text: "", frame: "close", motion: "they move", status: "planned" }));
    await startShots(t.db, id, shots, {
      pair: [JUNIPER, RAFE],
      cast: reelCast(ca, cb, id),
      places: [null, null],
      stages: [2, 4],
      bases: ["base-juniper", "base-rafe"],
      nudeBases: ["nude-juniper", "base-rafe"],
      venice: "placeholder-venice",
      hive: "placeholder-hive",
      model: "wan-3-0-image-to-video",
      baseUrl: BASE_URL,
      replicate: null,
    });
    expect(edits.map((e) => e.images.slice(0, 2)).sort()).toEqual([
      ["base-juniper", "base-rafe"],
      ["nude-juniper", "base-rafe"],
    ]);
  });
});

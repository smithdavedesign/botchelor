import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { GET as picturesGet, POST as picturesPost } from "@/app/api/admin/after-dark/pictures/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { ACTS } from "@/lib/adult/acts";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { mediaLimitsOf } from "@/lib/adult/clips";
import { listMedia } from "@/lib/adult/media";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { OUTFITS, picturePlaces } from "@/lib/adult/pictures-menu";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { getAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { normalizeScene } from "@/lib/venues";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Picture shot menus (lib/adult/pictures-menu.ts; David 2026-10-22): no live calls here.
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
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
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
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
const MINOR = { choices: [{ message: { role: "assistant", content: '{"answer": "MINOR"}' } }] };
function fakeHive(answer: (vlm: boolean) => unknown = (vlm) => (vlm ? ADULTS : CLEAN_MOD)) {
  const seen: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    const vlm = String(input) === HIVE_VLM;
    seen.push(vlm ? "vlm" : "moderation");
    const a = answer(vlm);
    return a instanceof Response ? a : Response.json(a);
  });
  return seen;
}
function fakeVenice(keyframe?: () => Response) {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    seen.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    if (path === "/image/multi-edit") return keyframe?.() ?? new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    return new Response("?", { status: 500 });
  });
  return seen;
}
const mediaOf = (url: unknown) => String(url).match(/media\/([^?]+)/)?.[1];

/** After Dark on (Venice and Hive keys), both baselines in, and the pair's scene at `stage` in `place`. */
async function ready(cookie: string, ownerId: string, opts: { stage?: number; place?: string; history?: unknown[]; settings?: Record<string, unknown> } = {}) {
  await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", ...opts.settings }, cookie);
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4) on conflict do nothing`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene as { id: string };
  const place = opts.place ?? "her bedroom";
  await t.db.query(`update adult_scenes set stage = $2, place = $3, set_place = $3, place_history = $4::jsonb, lines = $5::jsonb where id = $1`, [
    scene.id,
    opts.stage ?? 0,
    place,
    JSON.stringify(opts.history ?? []),
    JSON.stringify([{ who: "a", text: "Hello there, you.", stage: opts.stage ?? 0 }]),
  ]);
  return scene;
}
const menu = async (cookie: string) =>
  (await (await picturesGet(new Request(`${BASE_URL}/api/admin/after-dark/pictures?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()) as {
    price: number;
    left: number | null;
    acts: { id: string; available: boolean; outfits: string[] }[];
    outfits: { id: string; available: boolean; why: string | null; private: boolean }[];
    framings: { id: string }[];
    places: { place: string; now: boolean; public: boolean }[];
  };
const picture = (cookie: string, choice: Record<string, unknown>) => call(picturesPost, "/api/admin/after-dark/pictures", { a: RAFE, b: JUNIPER, framing: "medium", place: "her bedroom", ...choice }, cookie);
const pictures = async (ownerId: string) => (await t.db.query<{ n: number }>(`select pictures as n from adult_usage where owner_id = $1`, [ownerId])).rows[0]?.n ?? 0;

describe("the picture menu", () => {
  it("offers the act, what they wear by how far the night has gone, the framing, and the night's places", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, {
      stage: 1,
      place: "her bedroom",
      history: [
        { place: "the restaurant", set: "restaurant", home: null, chapter: 1 },
        { place: "her bedroom", set: "her bedroom", home: "a", chapter: 1 },
      ],
    });
    const m = await menu(cookie);
    expect(m.price).toBe(0);
    expect(m.left).toBeNull();
    expect(Object.fromEntries(m.outfits.map((o) => [o.id, o.available ? "yes" : o.why]))).toEqual({
      tonight: "yes",
      dressed_up: "yes",
      casual: "yes",
      underwear: "Once they've got to undressing",
      half: "Once they've got to undressing",
      sheet: "Once they've got to sex",
      nude: "Once they've got to sex",
    });
    expect(m.acts.find((a) => a.id === "cuddle")).toMatchObject({ available: true });
    expect(m.acts.find((a) => a.id === "on_top")).toMatchObject({ available: false, outfits: ["nude", "half"] });
    expect(m.framings.map((f) => f.id)).toEqual(["wide", "medium", "close"]);
    expect(m.places).toEqual([
      { place: "her bedroom", now: true, public: false, home: "a" },
      { place: "restaurant", now: false, public: true, home: null },
    ]);
    // The pair's limits: flirty never goes past undressing, so nothing nude and no sex on the menu at all.
    await t.db.query(`update adult_scenes set intensity = 'flirty', stage = 4`);
    const flirty = await menu(cookie);
    expect(flirty.outfits.map((o) => o.id)).toEqual(["tonight", "dressed_up", "casual", "underwear", "half"]);
    expect(flirty.acts.some((a) => a.id === "on_top")).toBe(false);
    expect(flirty.acts.find((a) => a.id === "cuddle")!.outfits).not.toContain("sheet");
  });

  it("lists the places once each, where they are now first", () => {
    const places = picturePlaces({
      place: "Juniper's bedroom",
      set: "Juniper's bedroom",
      history: [
        { place: "the bar", set: "bar", home: null },
        { place: "the street", set: "street", home: null },
        { place: "Juniper's bedroom", set: "Juniper's bedroom", home: "a" },
      ],
    });
    expect(places.map((p) => [p.place, p.now, p.public])).toEqual([
      ["Juniper's bedroom", true, false],
      ["street", false, true],
      ["bar", false, true],
    ]);
  });
});

describe("a picture of both of them", () => {
  it("is drawn from both baselines in the place's set, as composed, checked before it's kept, and kept in their gallery", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 4 });
    await t.db.query(`insert into place_sets (normalized, label, status, mime, data) values ($1, $2, 'ready', 'image/jpeg', $3)`, [normalizeScene("her bedroom"), "her bedroom", Buffer.from([0xff, 0xd8, 0xff])]);
    const seen = fakeVenice();
    const checks = fakeHive();
    const res = await picture(cookie, { act: "on_top", outfit: "nude", framing: "wide" });
    expect(res.status).toBe(200);
    const made = (await res.json()).picture as { id: string; kind: string; character_id: string; character_b: string };
    expect(made).toMatchObject({ kind: "scene", character_id: JUNIPER, character_b: RAFE });
    const edit = seen.find((s) => s.path === "/image/multi-edit")!;
    expect((edit.body.images as string[]).slice(0, 2).map(mediaOf)).toEqual(["base-juniper", "base-rafe"]);
    expect((edit.body.images as string[])[2]).toMatch(/^data:image\/jpeg;base64,/);
    const prompt = String(edit.body.prompt);
    expect(prompt).toMatch(/^Make one photograph of the woman from Picture 1 and the man from Picture 2 together, in the place from Picture 3\./);
    expect(prompt).toContain("the woman sits astride the man's hips");
    expect(prompt).toContain("A wide shot: the whole of both of them, head to toe, and the room around them.");
    expect(prompt).toContain("but not their clothes: both nude.");
    expect(prompt).toContain("Explicit, uncensored, photorealistic. Both are adults.");
    expect(prompt).not.toMatch(/Juniper|Rafe/);
    expect(prompt.length).toBeLessThanOrEqual(1500);
    expect(checks).toEqual(["moderation", "vlm"]);
    expect((await listMedia(t.db, [JUNIPER, RAFE])).map((m) => m.id)).toContain(made.id);
    expect(await pictures(id)).toBe(1);
    // Swapped, he's on top; framed close, dressed up for a kiss in the bedroom.
    seen.length = 0;
    expect((await picture(cookie, { act: "on_top", outfit: "half", swap: true })).status).toBe(200);
    expect(String(seen[0].body.prompt)).toContain("the man sits astride the woman's hips");
    expect(String(seen[0].body.prompt)).toContain("but not their clothes: both half undressed, their clothes half off or pushed aside.");
    seen.length = 0;
    expect((await picture(cookie, { act: "kiss", outfit: "dressed_up", framing: "close" })).status).toBe(200);
    expect(String(seen[0].body.prompt)).toContain("A close shot of their faces and shoulders.");
    expect(String(seen[0].body.prompt)).toContain("but not their clothes: both dressed up for a night out in smart evening clothes, fully clothed.");
    expect(String(seen[0].body.prompt)).not.toContain("Explicit");
  });

  it("refuses what the night hasn't reached, what doesn't go together, and anything past kissing somewhere public, before anything is spent", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 2, history: [{ place: "the restaurant", set: "restaurant", home: null, chapter: 1 }] });
    const seen = fakeVenice();
    fakeHive();
    const refused = async (choice: Record<string, unknown>) => {
      const res = await picture(cookie, choice);
      return [res.status, (await res.json()).message];
    };
    expect(await refused({ act: "on_top", outfit: "nude" })).toEqual([422, "On top: once they've got to sex."]);
    expect(await refused({ act: "kiss", outfit: "nude" })).toEqual([422, "Nude: once they've got to sex."]);
    await t.db.query(`update adult_scenes set stage = 4`);
    expect(await refused({ act: "undress", outfit: "nude" })).toEqual([422, 'Undressing each other doesn\'t go with "nude".']);
    expect(await refused({ act: "kiss", outfit: "underwear", place: "restaurant" })).toEqual([422, "Underwear: somewhere private first."]);
    expect(await refused({ act: "on_top", outfit: "nude", place: "restaurant" })).toEqual([422, "On top: somewhere private first."]);
    expect((await picture(cookie, { act: "kiss", outfit: "tonight", place: "the moon" })).status).toBe(422);
    expect((await picture(cookie, { act: "kiss", outfit: "tonight", framing: "fisheye" })).status).toBe(422);
    // A hard no rules the act out whatever the outfit.
    await t.db.query(`update adult_scenes set hard_nos = '{"chips": ["oral"], "own": []}'::jsonb`);
    expect(await refused({ act: "oral", outfit: "nude" })).toEqual([422, "That's past the limits you've set for these two."]);
    expect(seen).toHaveLength(0);
    expect(await pictures(id)).toBe(0);
    // A kiss in the restaurant, dressed, is fine.
    expect((await picture(cookie, { act: "kiss", outfit: "tonight", place: "restaurant" })).status).toBe(200);
  });

  it("costs a subscriber menu_picture_tokens (1), counts against the month's pictures, and gives the token back when it isn't kept", async () => {
    const { id: adminId, cookie: adminCookie } = await admin();
    await ready(adminCookie, adminId, { stage: 2 });
    expect((await getAdultSettings(t.db)).menu_picture_tokens).toBe(1);
    const sub = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    const cookie = signedIn(sub);
    await ready(cookie, sub, { stage: 2 });
    await t.db.query(`update adult_settings set cap_pictures = 2`);
    const used = async () => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [sub])).rows[0]?.used ?? 0;
    expect(await menu(cookie)).toMatchObject({ price: 1, left: 2 });
    fakeVenice();
    fakeHive();
    expect((await picture(cookie, { act: "kiss", outfit: "tonight" })).status).toBe(402);
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 10, 'test')`, [crypto.randomUUID(), sub]);
    // The age check refuses it: discarded, never stored, logged, the token back, not counted.
    fakeHive((vlm) => (vlm ? MINOR : CLEAN_MOD));
    const discarded = await picture(cookie, { act: "kiss", outfit: "tonight" });
    expect(discarded.status).toBe(422);
    expect((await discarded.json()).message).toMatch(/^The safety check discarded that picture \(age check: MINOR\)\. Your token is back\.$/);
    expect((await t.db.query<{ reason: string }>(`select reason from adult_rejections`)).rows.map((r) => r.reason)).toEqual(["menu picture: age check: MINOR"]);
    // Hive busy: not kept either, and not a refusal.
    fakeHive(() => new Response("slow down", { status: 429 }));
    expect((await picture(cookie, { act: "kiss", outfit: "tonight" })).status).toBe(503);
    // Venice out of credit.
    fakeHive();
    fakeVenice(() => new Response(JSON.stringify({ error: "Insufficient USD or Diem balance" }), { status: 402 }));
    const broke = await picture(cookie, { act: "kiss", outfit: "tonight" });
    expect(broke.status).toBe(502);
    expect((await broke.json()).message).toMatch(/^The picture couldn't be made \(Venice 402/);
    expect(await used()).toBe(0);
    expect(await pictures(sub)).toBe(0);
    expect((await t.db.query(`select 1 from adult_images where kind = 'scene'`)).rows).toHaveLength(0);
    // Two that come through: paid for and counted; the third is over the month's cap, refused before anything's spent.
    fakeVenice();
    expect((await picture(cookie, { act: "kiss", outfit: "tonight" })).status).toBe(200);
    expect((await picture(cookie, { act: "cuddle", outfit: "casual", framing: "wide" })).status).toBe(200);
    expect(await used()).toBe(2);
    expect(await pictures(sub)).toBe(2);
    const capped = await picture(cookie, { act: "kiss", outfit: "tonight" });
    expect(capped.status).toBe(429);
    expect((await capped.json()).message).toMatch(/this month's 2 pictures/);
    expect(await used()).toBe(2);
  });

  it("is drawn on Replicate's Qwen-Image-Edit when that's the media provider", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, { stage: 2, settings: { media_provider: "replicate", replicate_key: "placeholder-replicate-RPLC" } });
    fakeHive();
    const seen: { url: string; body?: Record<string, unknown> }[] = [];
    setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith("https://replicate.delivery/")) return new Response(PNG, { headers: { "content-type": "image/png" } });
      if (url.includes("/models/qwen/qwen-image-edit-2511/predictions")) return Response.json({ id: "k1", status: "succeeded", output: ["https://replicate.delivery/xe/k1/out-0.png"] }, { status: 201 });
      return new Response("unexpected", { status: 500 });
    });
    expect((await picture(cookie, { act: "kiss", outfit: "tonight" })).status).toBe(200);
    const input = seen.find((s) => s.url.includes("qwen-image-edit"))!.body!.input as { image: string[]; disable_safety_checker: boolean; prompt: string };
    expect(input.image.map(mediaOf)).toEqual(["base-juniper", "base-rafe"]);
    expect(input).toMatchObject({ disable_safety_checker: true });
    expect(input.prompt).toContain("The woman and the man kiss slowly, faces close");
  });

  it("keeps Filthy (one above explicit, v2.3) as explicit as explicit; spicy and below sensual", () => {
    const none = { chips: [], own: [] };
    expect(mediaLimitsOf({ intensity: "filthy", hard_nos: none })).toMatchObject({ explicit: true, maxStage: 4 });
    expect(mediaLimitsOf({ intensity: "explicit", hard_nos: none }).explicit).toBe(true);
    expect(mediaLimitsOf({ intensity: "spicy", hard_nos: none }).explicit).toBe(false);
    expect(mediaLimitsOf({ intensity: "flirty", hard_nos: none }).maxStage).toBe(3);
  });

  it("gives every act an outfit it goes with, and every outfit's words pass the two lines", () => {
    for (const act of ACTS) {
      expect(act.outfits.length).toBeGreaterThan(0);
      for (const o of act.outfits) expect(OUTFITS.some((x) => x.id === o)).toBe(true);
    }
  });
});

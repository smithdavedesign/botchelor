import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as studioGet, POST as studioPost } from "@/app/api/admin/after-dark/studio/route";
import { GET as mediaRequestGet } from "@/app/api/admin/after-dark/media/[id]/request/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { crossesTaboo } from "@/lib/adult/acts";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { getAdultSettings, saveAdultSettings } from "@/lib/adult/settings";
import { rateMedia } from "@/lib/adult/steering";
import { restyleCurrent, restyleMenu, restyleWords, setStudioPausesForTests, studioAccess } from "@/lib/adult/studio";
import {
  ALL_OPTION_IDS,
  animatePrompt,
  bodyPrompt,
  CUSTOM_MAX,
  planShoot,
  restylePrompt,
  shootPrompt,
  STUDIO_GROUPS,
  STUDIO_PROMPT_MAX,
  studioMenu,
  type ShootLimits,
  type Subject,
} from "@/lib/adult/studio-catalog";
import { DEFAULT_STUDIO_CONFIG, mergeStudioConfig, studioConfigOf } from "@/lib/adult/studio-config";
import { studioTileSpecs } from "@/lib/adult/studio-tiles";
import { isTileId, tileSpecs } from "@/lib/looks";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { checkAdultText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// The After Dark Studio (lib/adult/studio*.ts, docs/PRDs/studio.md; David, 2026-10-24). No live calls: Venice, Replicate
// and Hive are stubbed, and every option's words are stand-ins written to the lines.

/** Words that read young: none may appear in an option a picture model reads (on top of checkAdultText). */
const YOUNG = /\b(teen\w*|young\w*|girl\w*|boy\w*|school\w*|student\w*|petite|little|tiny|child\w*|kid\w*|underage|minor\w*|babysit\w*|cheerlead\w*|braces|pigtail\w*|barely|innocent|virgin)\b/i;

const ALL: ShootLimits = { maxLevel: 3, hardNos: [], disabled: new Set(), pov: true };
const her: Subject = { noun: "woman", age: 18, look: "long copper-red hair, green eyes", outfit: "a fitted white t-shirt and blue jeans" };

describe("the Studio's menus", () => {
  it("are written to the lines: every option's words, for anyone, pass the checks and read adult", () => {
    expect(new Set(ALL_OPTION_IDS).size).toBe(ALL_OPTION_IDS.length);
    for (const g of STUDIO_GROUPS) {
      for (const o of g.options) {
        for (const words of [o.words, o.man, o.person].filter((w): w is string => Boolean(w))) {
          expect(checkAdultText({ words }).ok, `${g.id}.${o.id}: ${words}`).toBe(true);
          expect(crossesTaboo(words), `${g.id}.${o.id}`).toBe(false);
          expect(YOUNG.test(words), `${g.id}.${o.id}: ${words}`).toBe(false);
        }
      }
    }
  });

  it("plans a shoot at its highest choice's level, nothing past suggestive in public, within the limits and hard nos", () => {
    const ok = planShoot({ pose: "standing", wardrobe: "lingerie", place: "hotel", accessories: ["choker", "heels"] }, ALL, her);
    expect(ok.ok && ok.plan.level).toBe(1);
    expect(ok.ok && ok.plan.place).toBe("a luxury hotel suite with a city view");
    const pub = planShoot({ wardrobe: "nude", place: "beach" }, ALL, her);
    expect(pub).toMatchObject({ ok: false, error: "public" });
    const flirty = planShoot({ wardrobe: "nude" }, { ...ALL, maxLevel: 1 }, her);
    expect(flirty).toMatchObject({ ok: false, error: "locked" });
    expect(planShoot({ pose: "toy" }, { ...ALL, hardNos: ["toys"] }, her)).toMatchObject({ ok: false, error: "locked" });
    expect(planShoot({ pov: "kneel" }, { ...ALL, hardNos: ["oral"] }, her)).toMatchObject({ ok: false, error: "locked" });
    expect(planShoot({ pov: "looking" }, { ...ALL, pov: false }, her)).toMatchObject({ ok: false, error: "locked" });
    expect(planShoot({ pose: "nope" }, ALL, her)).toMatchObject({ ok: false, error: "unknown_option" });
    expect(planShoot({ accessories: ["glasses", "choker", "pearls", "watch"] }, ALL, her)).toMatchObject({ ok: false, error: "too_many" });
    expect(planShoot({ pose: "standing" }, { ...ALL, disabled: new Set(["pose.standing"]) }, her)).toMatchObject({ ok: false, error: "locked" });
    // A place of their own, public or not.
    expect(planShoot({ place: "own:0", wardrobe: "nude" }, ALL, her, { place: "her bedroom", public: false })).toMatchObject({ ok: true });
    expect(planShoot({ place: "own:0", wardrobe: "nude" }, ALL, her, { place: "the bar", public: true })).toMatchObject({ ok: false, error: "public" });
    // The menu says why a choice is locked.
    const menu = studioMenu({ ...ALL, maxLevel: 1, hardNos: ["toys"] }, "woman");
    const pose = menu.find((g) => g.id === "pose")!;
    expect(pose.options.find((o) => o.id === "toy")!.locked).toMatch(/studio limit/);
    expect(menu.find((g) => g.id === "accessories")!.options.some((o) => o.id === "garter")).toBe(true);
    expect(studioMenu(ALL, "man").find((g) => g.id === "accessories")!.options.some((o) => o.id === "garter")).toBe(false);
  });

  it("writes the shoot's prompt: their face first, an adult never under 21, each choice, the level's closing words, within the limit", () => {
    const planned = planShoot({ pose: "front", pov: "beside", wardrobe: "nude", light: "golden", expression: "sultry" }, ALL, her);
    if (!planned.ok) throw new Error(planned.message);
    const p = shootPrompt(planned.plan, her, { body: true, set: false });
    expect(p).toMatch(/^Make one photograph of the woman from Picture 1, with the body from Picture 2\./);
    expect(p).toContain("A 21-year-old adult woman, long copper-red hair, green eyes.");
    expect(p).toContain("Not their clothes: fully nude.");
    // Picture 1 is the face anchor: the directions change everything but the face.
    expect(p).toContain("Picture 1 is the face to keep");
    expect(p).toContain("Camera: a first-person view from the pillow beside her");
    expect(p).toMatch(/Uncensored, photorealistic\. Everyone shown is an adult\.$/);
    expect(p.length).toBeLessThanOrEqual(STUDIO_PROMPT_MAX);
    const withSet = shootPrompt(planned.plan, her, { body: false, set: true }, "strict");
    expect(withSet).toMatch(/^Make one photograph of the woman from Picture 1, in the place from Picture 2\./);
    expect(withSet).toContain("identical to their own picture");
    expect(restylePrompt(her, ["copper-red hair"], "natural light")).toContain("Change only this: copper-red hair.");
    expect(bodyPrompt(her, false)).toContain("Full body, head to toe");
    expect(bodyPrompt(her, true)).toContain("Wearing fully nude");
  });

  it("puts the owner's own words first and adds their per-section words, trimmed and capped", () => {
    const planned = planShoot({ pose: "front", wardrobe: "nude", custom: "  she is on her knees, looking up into the lens  ", extra: { place: "steam everywhere, the bench slick", light: "   " } }, ALL, her);
    if (!planned.ok) throw new Error(planned.message);
    // Trimmed; an empty per-section entry is dropped.
    expect(planned.plan.custom).toBe("she is on her knees, looking up into the lens");
    expect(planned.plan.extra).toEqual({ place: "steam everywhere, the bench slick" });
    const p = shootPrompt(planned.plan, her, { body: false, set: false });
    // The owner's words lead, so what they ask for actually happens.
    expect(p).toContain("Most important, do exactly this: she is on her knees, looking up into the lens.");
    // The per-section words appear, named by their section.
    expect(p).toContain("Also — place: steam everywhere, the bench slick.");
    expect(p.length).toBeLessThanOrEqual(STUDIO_PROMPT_MAX);
    // The owner's words are capped.
    const long = planShoot({ custom: "x ".repeat(CUSTOM_MAX) }, ALL, her);
    expect(long.ok && (long.plan.custom?.length ?? 0)).toBeLessThanOrEqual(CUSTOM_MAX);
    // A dialog line becomes a speech bubble on the picture.
    const withDialog = planShoot({ wardrobe: "nude", dialog: "come closer" }, ALL, her);
    if (!withDialog.ok) throw new Error(withDialog.message);
    expect(withDialog.plan.dialog).toBe("come closer");
    expect(shootPrompt(withDialog.plan, her, { body: false, set: false })).toContain('A speech bubble near them reads: "come closer".');
  });

  it("guides a clip: the owner's direction leads, their dialog and the transcript shape it, a motion optional", () => {
    const base = animatePrompt({ noun: "woman" }, 2, "sways slowly");
    expect(base).toContain("The woman in the picture sways slowly.");
    // The face is held steady through the clip.
    expect(base).toContain("Keep the same face throughout");
    const guided = animatePrompt({ noun: "woman" }, 3, "", { guide: "  she kneels and looks up  ", dialog: 'say "hi"', transcript: "They'd been teasing each other all night." });
    expect(guided).toContain("Most important, do exactly this: she kneels and looks up.");
    expect(guided).toContain("They say, their lips moving: \"say 'hi'\".");
    expect(guided).toContain("what's being said around this moment: They'd been teasing each other all night.");
    expect(guided).not.toContain("breathes slowly"); // a guide stands in for a motion chip
    expect(guided.length).toBeLessThanOrEqual(STUDIO_PROMPT_MAX);
    // A pair picture animates both of them: "two people", and both kept.
    const two = animatePrompt({ noun: "woman" }, 3, "move together", {}, { pair: true });
    expect(two).toContain("The two people in the picture move together.");
    expect(two).toContain("Only these two people, exactly as in the picture");
    expect(two).not.toContain("Only this one person");
  });

  it("restyles with the looks builder's own chips, and takes a detail away with none", () => {
    expect(restyleWords("woman", { hair_style: "short", hair_color: "red", glasses: "none" })).toEqual({ ok: true, words: ["a short chin-length copper-red bob", "no glasses"] });
    expect(restyleWords("man", { facial_hair: "stubble" })).toEqual({ ok: true, words: ["light even stubble"] });
    expect(restyleWords("woman", { hair_style: "buzz" })).toMatchObject({ ok: false });
    expect(restyleWords("woman", {})).toMatchObject({ ok: false });
    expect(restyleMenu("man").some((g) => g.id === "breasts")).toBe(false);
    expect(restyleMenu(null).some((g) => g.id === "hair_style")).toBe(false);
  });

  it("opens Filthy's own acts only at the Filthy intensity, in place of the pose, the viewer only at the frame's edge", () => {
    expect(planShoot({ filthy: "spread_close" }, ALL, her)).toMatchObject({ ok: false, error: "locked" });
    const filthy = { ...ALL, filthy: true };
    const solo = planShoot({ filthy: "spread_close", pose: "standing", place: "bedroom" }, filthy, her);
    expect(solo.ok && solo.plan.level).toBe(3);
    const p = solo.ok ? shootPrompt(solo.plan, her, { body: false, set: false }) : "";
    expect(p).toContain("What's happening: lying back with her legs spread wide");
    expect(p).not.toContain("Pose: standing");
    expect(p).toContain("Only this one person in the picture");
    const pov = planShoot({ filthy: "pov_riding", framing: "close" }, filthy, her);
    const q = pov.ok ? shootPrompt(pov.plan, her, { body: false, set: false }) : "";
    expect(q).toContain("of the viewer, at most hands, hips or legs at the edge of the frame, never a face");
    expect(q).not.toContain("Camera: a close shot");
    // Hard nos still take an act away, and nothing explicit somewhere public.
    expect(planShoot({ filthy: "pov_blowjob" }, { ...filthy, hardNos: ["oral"] }, her)).toMatchObject({ ok: false, error: "locked" });
    expect(planShoot({ filthy: "orgasm", place: "beach" }, filthy, her)).toMatchObject({ ok: false, error: "public" });
    expect(studioMenu(filthy, "man").find((g) => g.id === "filthy")!.options.some((o) => o.id === "squirting")).toBe(false);
  });

  it("draws its own menu pictures (never another site's), each an After Dark tile written to the lines", () => {
    const specs = studioTileSpecs();
    expect(new Set(specs.map((x) => x.id)).size).toBe(specs.length);
    expect(specs.some((x) => x.id === "nsfw-woman-studio_filthy-spread-close")).toBe(true);
    expect(specs.some((x) => x.id === "nsfw-man-studio_filthy-squirting")).toBe(false);
    const looks = new Set(tileSpecs().map((x) => x.id));
    for (const x of specs) {
      expect(isTileId(x.id) && x.variant === "nsfw", x.id).toBe(true);
      expect(looks.has(x.id), x.id).toBe(false);
      expect(checkAdultText({ words: x.prompt }).ok, x.id).toBe(true);
      expect(crossesTaboo(x.prompt), x.id).toBe(false);
      expect(YOUNG.test(x.prompt), `${x.id}: ${x.prompt}`).toBe(false);
      expect(x.prompt).toContain("Everyone shown is an adult.");
    }
  });

  it("starts the restyle on their look as they were made, After Dark's private picks for their owner only", () => {
    const looks = { gender: "woman" as const, eyes: "blue" as const, hair_color: "red" as const, facial_hair: undefined, after_dark: { butt: "small" as const, grooming: "shaved" as const } };
    expect(restyleCurrent(looks, "woman", true)).toEqual({ eyes: "blue", hair_color: "red", butt: "small", grooming: "shaved" });
    expect(restyleCurrent(looks, "woman", false)).toEqual({ eyes: "blue", hair_color: "red" });
    // A pick that isn't on this gender's menu is left out (no butt step for a man).
    expect(restyleCurrent(looks, "man", true)).not.toHaveProperty("butt");
    expect(restyleCurrent(undefined, "woman", true)).toEqual({});
  });

  it("keeps every setting configurable, with defaults, and refuses a bad save", () => {
    expect(studioConfigOf(null)).toEqual(DEFAULT_STUDIO_CONFIG);
    expect(DEFAULT_STUDIO_CONFIG.prices.shoot).toEqual({ standard: 1, pro: 2 });
    // A hand-edited row keeps what parses.
    expect(studioConfigOf({ shoot_size: 2, prices: "nope" }).shoot_size).toBe(2);
    expect(mergeStudioConfig(DEFAULT_STUDIO_CONFIG, { prices: { restyle: 3 } }).prices).toMatchObject({ restyle: 3, recast: 1 });
    expect(() => mergeStudioConfig(DEFAULT_STUDIO_CONFIG, { shoot_size: 9 })).toThrow();
    expect(() => mergeStudioConfig(DEFAULT_STUDIO_CONFIG, { default_edit: "lustify-v8" })).toThrow(/default_edit/);
  });
});

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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setReplicatePausesForTests(false);
  setStudioPausesForTests(false);
  setCheckSleepForTests(async () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setReplicateFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
  setStudioPausesForTests(true);
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.9 }] }] };
const answer = (a: string) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: a }) } }] });
function fakeHive(age = "ADULTS") {
  const seen: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    const vlm = String(input) === HIVE_VLM;
    seen.push(vlm ? "vlm" : "moderation");
    return Response.json(vlm ? answer(age) : CLEAN_MOD);
  });
  return seen;
}
/** Venice's multi-edit and image generation, stubbed: what each was sent. */
function fakeVenice(edit: () => Response = () => new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } })) {
  const edits: { model: string; prompt: string; images: string[] }[] = [];
  const news: { model: string; prompt: string }[] = [];
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (String(input).endsWith("/image/multi-edit")) {
      edits.push({ model: body.modelId, prompt: body.prompt, images: body.images });
      return edit();
    }
    return new Response("?", { status: 500 });
  });
  setMediaFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    news.push({ model: body.model, prompt: body.prompt });
    return Response.json({ images: [Buffer.from(PNG).toString("base64")] });
  });
  return { edits, news };
}

const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  studioPost(new Request(`${BASE_URL}/api/admin/after-dark/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const state = async (cookie: string, id: string) => studioGet(new Request(`${BASE_URL}/api/admin/after-dark/studio?character=${id}`, { headers: { cookie } }));

/** After Dark on, with Venice and Hive; an owner (admin or not) with a character of theirs switched in and a face to keep. */
async function setup(opts: { admin?: boolean; openTo?: "admins" | "entitled" } = {}) {
  const raw = newUserCookie();
  const owner = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her", age: 19 }), raw)).json()) as { id: string };
  const adminId = userIdOf(newUserCookie());
  await claimAdmin(t.db, adminId);
  if (opts.admin) await claimAdmin(t.db, owner);
  else await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [owner]);
  await saveAdultSettings(t.db, {
    enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", auto_scene_pictures: false,
    ...(opts.openTo ? { studio: { open_to: opts.openTo } } : {}),
  });
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, character.id]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [owner, character.id, Buffer.from(PNG)]);
  return { owner, cookie: signedIn(owner), character: character.id, adminCookie: signedIn(adminId) };
}
const used = async (who: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [who])).rows[0]?.used ?? 0;

describe("who may use the Studio", () => {
  it("is admins only by default, then everyone After Dark is open to; never on another person's character", async () => {
    const { owner, cookie, character, adminCookie } = await setup();
    expect((await state(cookie, character)).status).toBe(404);
    await saveAdultSettings(t.db, { studio: { open_to: "entitled" } });
    expect((await state(cookie, character)).status).toBe(200);
    // An admin can't use another person's character; the house cast, yes.
    expect((await state(adminCookie, character)).status).toBe(404);
    expect((await state(adminCookie, HOUSE_CHARACTERS[0].id)).status).toBe(200);
    // Switched out of After Dark: refused, with why.
    await t.db.query(`delete from adult_switches where owner_id = $1`, [owner]);
    expect((await studioAccess(t.db, owner, character)).ok).toBe(false);
    expect((await state(cookie, character)).status).toBe(409);
  });
});

describe("a shoot", () => {
  it("draws the shoot's pictures from their face, checks each, keeps them as theirs, and counts them", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    const seen = fakeHive();
    const { edits } = fakeVenice();
    const res = await post({ action: "shoot", character_id: character, choices: { pose: "lying_back", wardrobe: "nude", pov: "beside", light: "warm" } }, cookie);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.shoot).toMatchObject({ kind: "shoot", status: "ready", asked: 4, made: 4, tokens: 0, model: "qwen-edit-uncensored" });
    expect(out.pictures).toHaveLength(4);
    expect(edits).toHaveLength(4);
    expect(edits[0].model).toBe("qwen-edit-uncensored");
    expect(edits[0].images).toHaveLength(1);
    expect(edits[0].images[0]).toMatch(/\/api\/admin\/after-dark\/media\/face-1\?until=/);
    expect(edits[0].prompt).toContain("A 21-year-old adult woman");
    expect(seen.filter((x) => x === "vlm")).toHaveLength(4);
    const rows = (await t.db.query<{ kind: string; character_b: string | null; shoot_id: string; model: string; preset: string | null }>(`select kind, character_b, shoot_id, model, preset from adult_images where shoot_id is not null`)).rows;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.kind === "scene" && r.character_b === null && r.shoot_id === out.shoot.id && r.model === "qwen-edit-uncensored" && r.preset === "warm")).toBe(true);
    expect((await t.db.query<{ studio: number }>(`select studio from adult_usage where owner_id = $1`, [owner])).rows[0].studio).toBe(4);
    // Each keeps the request sent for it (lib/adult/request-log.ts): the edit's address and body, the face link unsigned.
    const sent = (await t.db.query<{ id: string; request: { at: string; body: { prompt: string; images: string[] } }[] }>(`select id, request from adult_images where shoot_id = $1`, [out.shoot.id])).rows;
    for (const r of sent) {
      expect(r.request).toHaveLength(1);
      expect(r.request[0].at).toMatch(/\/image\/multi-edit$/);
      expect(r.request[0].body.prompt).toBe(edits[0].prompt);
      expect(r.request[0].body.images[0]).toMatch(/media\/face-1\?until=\d+&sig=…$/);
    }
    // An admin sees it on a click of the title; anyone else, not found.
    const look = (cookie: string) => mediaRequestGet(new Request(`${BASE_URL}/api/admin/after-dark/media/${sent[0].id}/request`, { headers: { cookie } }), { params: Promise.resolve({ id: sent[0].id }) });
    const seenByAdmin = await (await look(cookie)).json();
    expect(seenByAdmin).toMatchObject({ id: sent[0].id, kind: "scene", model: "qwen-edit-uncensored", provider: "venice", shoot: { id: out.shoot.id, kind: "shoot" } });
    expect(seenByAdmin.request[0].body.prompt).toBe(edits[0].prompt);
    expect((await look(signedIn(userIdOf(newUserCookie())))).status).toBe(404);
    // The page's state has them in the gallery, from that shoot.
    expect(out.state.gallery.filter((g: { id: string }) => out.state.shoot_of[g.id] === out.shoot.id)).toHaveLength(4);
  });

  it("takes the owner's own words — a partial extra, custom and dialog — without demanding every section", async () => {
    const { cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    // Only two sections get the owner's own words; the schema must not demand the rest (zod partialRecord, not record).
    const res = await post({ action: "shoot", character_id: character, choices: { wardrobe: "nude", custom: "she looks right into the camera", dialog: "come here", extra: { pose: "leaning forward on her elbows", light: "candlelit" } } }, cookie);
    expect(res.status).toBe(200);
    expect(edits[0].prompt).toContain("Most important, do exactly this: she looks right into the camera.");
    expect(edits[0].prompt).toContain('A speech bubble near them reads: "come here".');
    expect(edits[0].prompt).toContain("Also — pose: leaning forward on her elbows");
    expect(edits[0].prompt).toContain("light: candlelit");
  });

  it("costs a subscriber the model's tier, gives the tokens back when nothing comes through, and refuses an over-limit shoot before spending", async () => {
    const { owner, cookie, character } = await setup({ openTo: "entitled" });
    fakeHive();
    fakeVenice();
    expect((await post({ action: "shoot", character_id: character, choices: {} }, cookie)).status).toBe(402);
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 10, 'test')`, [crypto.randomUUID(), owner]);
    expect((await (await post({ action: "shoot", character_id: character, choices: {} }, cookie)).json()).shoot.tokens).toBe(1);
    expect(await used(owner)).toBe(1);
    expect((await (await post({ action: "shoot", character_id: character, choices: {}, model: "seedream-v5-pro-edit" }, cookie)).json()).shoot.tokens).toBe(2);
    expect(await used(owner)).toBe(3);
    // Every picture refused by the age check: nothing kept, logged, tokens back.
    fakeHive("MINOR");
    const refused = await (await post({ action: "shoot", character_id: character, choices: {} }, cookie)).json();
    expect(refused.shoot).toMatchObject({ status: "failed", made: 0, tokens: 0 });
    expect(refused.refunded).toBe(true);
    expect(refused.message).toMatch(/Your tokens are back/);
    expect(await used(owner)).toBe(3);
    expect((await t.db.query<{ reason: string }>(`select reason from adult_rejections`)).rows[0].reason).toMatch(/^studio shoot: age check: MINOR/);
    // Their studio limit: flirty stops nude before anything is spent.
    fakeHive();
    expect((await post({ action: "limits", character_id: character, intensity: "flirty" }, cookie)).status).toBe(200);
    const locked = await post({ action: "shoot", character_id: character, choices: { wardrobe: "nude" } }, cookie);
    expect(locked.status).toBe(422);
    expect(await used(owner)).toBe(3);
    // The month's cap: fewer left than a shoot makes.
    await saveAdultSettings(t.db, { caps: { studio: 9 } });
    expect((await post({ action: "shoot", character_id: character, choices: {} }, cookie)).status).toBe(429);
  });

  it("adds their body reference as Picture 2, and a free redo for a shoot they 👎'd whole, once", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    const body = await (await post({ action: "body", character_id: character }, cookie)).json();
    expect(body.shoot).toMatchObject({ kind: "body", made: 2 });
    expect(edits[0].prompt).toContain("Full body, head to toe");
    expect((await post({ action: "use_body", character_id: character, image_id: body.pictures[0].id }, cookie)).status).toBe(200);
    const shot = await (await post({ action: "shoot", character_id: character, choices: { framing: "full" } }, cookie)).json();
    expect(edits.at(-1)!.images).toHaveLength(2);
    expect(edits.at(-1)!.prompt).toContain("with the body from Picture 2");
    expect(shot.state.identity.body).toBe(body.pictures[0].id);
    // Not redoable until every picture is 👎'd.
    expect((await post({ action: "redo", shoot_id: shot.shoot.id }, cookie)).status).toBe(409);
    for (const p of shot.pictures) await rateMedia(t.db, owner, p.id, -1, ["pose"]);
    const s = await (await state(cookie, character)).json();
    expect(s.state.shoots.find((x: { id: string }) => x.id === shot.shoot.id).redo).toBe(true);
    const redo = await (await post({ action: "redo", shoot_id: shot.shoot.id }, cookie)).json();
    expect(redo.shoot).toMatchObject({ redo_of: shot.shoot.id, tokens: 0, made: 4 });
    // What the 👎s said is in the redo's prompt.
    expect(edits.at(-1)!.prompt).toMatch(/a natural, relaxed pose/i);
    expect((await post({ action: "redo", shoot_id: shot.shoot.id }, cookie)).status).toBe(409);
  });

  it("makes a face anchor (a close-up) and then leads every shoot with it, Picture 1, in place of the baseline", async () => {
    const { cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    // Before: the shoot leads with the baseline (face-1).
    const first = await (await post({ action: "shoot", character_id: character, choices: {} }, cookie)).json();
    expect(first.state.identity.faceCrop).toBeFalsy();
    expect(edits[0].images[0]).toMatch(/media\/face-1\?until=/);
    // Make the anchor: one close-up, checked, set as the face anchor.
    const anchor = await (await post({ action: "face", character_id: character }, cookie)).json();
    expect(anchor.shoot).toMatchObject({ kind: "face", made: 1 });
    expect(anchor.pictures).toHaveLength(1);
    expect(anchor.state.identity.faceCrop).toBe(anchor.pictures[0].id);
    const headshot = edits.at(-1)!;
    expect(headshot.prompt).toContain("head-and-shoulders close-up");
    expect(headshot.images[0]).toMatch(/media\/face-1\?until=/); // drawn from the baseline
    // After: the shoot leads with the anchor, not the baseline.
    const next = await (await post({ action: "shoot", character_id: character, choices: {} }, cookie)).json();
    expect(next.state.identity.faceCrop).toBe(anchor.pictures[0].id);
    expect(edits.at(-1)!.images[0]).toContain(`media/${anchor.pictures[0].id}?until=`);
    expect(edits.at(-1)!.images[0]).not.toContain("face-1");
  });

  it("keeps the baseline (not the anchor) on loose strength", async () => {
    const { cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    const anchor = await (await post({ action: "face", character_id: character }, cookie)).json();
    expect(anchor.pictures).toHaveLength(1);
    await post({ action: "strength", character_id: character, strength: "loose" }, cookie);
    const shot = await (await post({ action: "shoot", character_id: character, choices: {} }, cookie)).json();
    expect(shot.state.identity.strength).toBe("loose");
    expect(edits.at(-1)!.images[0]).toMatch(/media\/face-1\?until=/);
    expect(edits.at(-1)!.images[0]).not.toContain(anchor.pictures[0].id);
  });
});

describe("identity", () => {
  it("restyles as edits of the face (baselines to pick from), saves the looks to their own character, and recasts with a new-picture model", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits, news } = fakeVenice();
    const r = await (await post({ action: "restyle", character_id: character, changes: { hair_color: "red", hair_style: "short" } }, cookie)).json();
    expect(r.shoot).toMatchObject({ kind: "restyle", made: 3 });
    expect(r.pictures.every((p: { kind: string }) => p.kind === "baseline")).toBe(true);
    expect(edits[0].prompt).toContain("Change only this: a short chin-length copper-red bob.");
    const saved = await (await post({ action: "save_looks", character_id: character, changes: { hair_color: "red", hair_style: "short" } }, cookie)).json();
    const row = (await t.db.query<{ extras: { looks?: { hair_color?: string; gender?: string } } }>(`select extras from characters where id = $1`, [character])).rows[0];
    expect(row.extras.looks).toMatchObject({ hair_color: "red", gender: "woman" });
    expect(saved.appearance).toContain("copper-red bob");
    const n = await (await post({ action: "recast", character_id: character, model: "chroma" }, cookie)).json();
    expect(n.shoot).toMatchObject({ kind: "recast", made: 3, model: "chroma" });
    expect(news).toHaveLength(3);
    expect(news[0].model).toBe("chroma");
    expect(news[0].prompt).toMatch(/waist-up, facing the camera/);
    // A model off the list, or of the wrong kind, is refused.
    expect((await post({ action: "recast", character_id: character, model: "qwen-edit-uncensored" }, cookie)).status).toBe(422);
    expect(owner).toBeTruthy();
  });
});

describe("the settings", () => {
  it("save the Studio's configuration and the caps, and refuse a bad value with why", async () => {
    const { adminCookie } = await setup({ admin: true });
    const save = (body: unknown) =>
      settingsPost(new Request(`${BASE_URL}/api/admin/after-dark/settings`, { method: "POST", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify(body) }));
    const ok = await (await save({ studio: { prices: { restyle: 2 }, pov: false }, caps: { studio: 120 } })).json();
    expect(ok.settings.studio.prices.restyle).toBe(2);
    expect(ok.settings.studio.pov).toBe(false);
    expect(ok.settings.caps.studio).toBe(120);
    const bad = await save({ studio: { shoot_size: 12 } });
    expect(bad.status).toBe(422);
    expect((await bad.json()).message).toMatch(/^Studio:/);
    expect((await getAdultSettings(t.db)).studio.shoot_size).toBe(4);
  });
});

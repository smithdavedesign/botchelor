import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as studioPost } from "@/app/api/admin/after-dark/studio/route";
import { POST as fixPost } from "@/app/api/admin/after-dark/fix-faces/route";
import { POST as pgPost } from "@/app/api/characters/[id]/studio/route";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { listMedia, setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { CAROUSEL_ANGLES } from "@/lib/adult/studio-catalog";
import { setStudioPausesForTests } from "@/lib/adult/studio";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { fitRatio } from "@/lib/media-tools/image";
import { readBytes } from "@/lib/object-store";
import { checkAdultText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { askRatio, FORMATS, ratioOf, ratiosFor, sizeFor } from "@/lib/studio/formats";
import { PG_CAROUSEL_ANGLES, pgCarouselPrompt } from "@/lib/studio/pg-catalog";
import { setPgStudioFetchForTests, setPgStudioPausesForTests } from "@/lib/studio/pg";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Native sizes and carousels (the creator suite, 2026-10-26: lib/studio/formats.ts). No live calls: Venice, Hive and
// the PG check are stubbed; the pictures are real PNGs, so the cut to a shape is real too.

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#7a6080" } }).png().toBuffer();
const dims = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return [m.width, m.height];
};

describe("the formats", () => {
  it("ask each model for the shape when it takes it, else the nearest, with sizes for the ones sized by width and height", () => {
    expect(FORMATS.map((f) => f.ratio)).toEqual(["3:4", "9:16", "4:5", "1:1", "16:9"]);
    expect(ratioOf("story")).toBe("9:16");
    expect(ratioOf(undefined)).toBe("3:4");
    expect(ratioOf("nonsense")).toBe("3:4");
    // Venice's edit takes 4:5; Seedream and Replicate don't, and get 3:4 (then cut).
    expect(askRatio("4:5", ratiosFor("venice", "qwen-edit-uncensored"))).toBe("4:5");
    expect(askRatio("4:5", ratiosFor("venice", "seedream-v5-pro-edit"))).toBe("3:4");
    expect(askRatio("4:5", ratiosFor("replicate", "qwen/qwen-image-edit-2511"))).toBe("3:4");
    for (const f of FORMATS) {
      expect(askRatio(f.ratio, ratiosFor("venice", "qwen-edit-uncensored"))).toBe(f.ratio === "4:5" ? "4:5" : f.ratio);
      const { width, height } = sizeFor(f.ratio);
      expect(width % 16).toBe(0);
      expect(height % 16).toBe(0);
    }
  });

  it("cut a picture to its shape a quarter of the way down, and leave one already that shape (or unreadable) as it is", async () => {
    const portrait = await png(300, 400);
    const story = await fitRatio({ bytes: portrait, mime: "image/png" }, "9:16");
    expect(await dims(story.bytes)).toEqual([225, 400]);
    const wide = await fitRatio({ bytes: portrait, mime: "image/png" }, "16:9");
    expect(await dims(wide.bytes)).toEqual([300, 169]);
    const same = { bytes: portrait, mime: "image/png" };
    expect(await fitRatio(same, "3:4")).toBe(same);
    const junk = { bytes: Buffer.from([1, 2, 3]), mime: "image/png" };
    expect(await fitRatio(junk, "1:1")).toBe(junk);
  });

  it("go round one picture's moment in six angles, a new pose never, to the lines", () => {
    expect(CAROUSEL_ANGLES).toHaveLength(6);
    expect(PG_CAROUSEL_ANGLES).toHaveLength(6);
    for (const a of PG_CAROUSEL_ANGLES) {
      const p = pgCarouselPrompt({ noun: "woman", age: 29, look: "auburn hair" }, true, a);
      expect(p).toContain("at the very moment in the second reference picture");
      expect(p).toContain("The same pose, clothes, place and light");
      expect(checkAdultText({ words: p }).ok).toBe(true);
    }
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
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setReplicatePausesForTests(false);
  setStudioPausesForTests(false);
  setPgStudioPausesForTests(false);
  setCheckSleepForTests(async () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  setPgStudioFetchForTests(null);
  setModerationFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
  setStudioPausesForTests(true);
  setPgStudioPausesForTests(true);
});

const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.9 }] }] };
function fakeHive() {
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(String(input) === HIVE_VLM ? { choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: "ADULTS" }) } }] } : CLEAN_MOD),
  );
}
/** Venice's multi-edit, stubbed: what each was sent; every answer a 3:4 PNG, whatever shape was asked. */
async function fakeVenice() {
  const portrait = await png(300, 400);
  const edits: { model: string; prompt: string; images: string[]; aspect_ratio: string }[] = [];
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (!String(input).endsWith("/image/multi-edit")) return new Response("?", { status: 500 });
    edits.push({ model: body.modelId, prompt: body.prompt, images: body.images, aspect_ratio: body.aspect_ratio });
    return new Response(new Uint8Array(portrait), { headers: { "content-type": "image/png" } });
  });
  return edits;
}
const post = (body: unknown, cookie: string) =>
  studioPost(new Request(`${BASE_URL}/api/admin/after-dark/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
async function setup(opts: { admin?: boolean } = {}) {
  const raw = newUserCookie();
  const owner = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her", age: 29 }), raw)).json()) as { id: string };
  if (opts.admin) await claimAdmin(t.db, owner);
  else await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [owner]);
  await saveAdultSettings(t.db, {
    enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", auto_scene_pictures: false,
    ...(opts.admin ? {} : { studio: { open_to: "entitled" } }),
  });
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, character.id]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [owner, character.id, await png(300, 400)]);
  return { owner, cookie: signedInCookie(owner), character: character.id };
}

describe("After Dark's native sizes", () => {
  it("draws a shoot in the shape picked, cut to it when the model came back another, and keeps the shape on each", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const edits = await fakeVenice();
    const out = await (await post({ action: "shoot", character_id: character, choices: {}, format: "story" }, cookie)).json();
    expect(out.pictures).toHaveLength(4);
    expect(edits.every((e) => e.aspect_ratio === "9:16")).toBe(true);
    const row = (await t.db.query<{ aspect: string; data: Buffer | null; object_key: string | null }>(`select aspect, data, object_key from adult_images where id = $1`, [out.pictures[0].id])).rows[0];
    expect(row.aspect).toBe("9:16");
    expect(await dims((await readBytes(row))!)).toEqual([225, 400]);
    expect(out.pictures[0].aspect).toBe("9:16");
    expect((await listMedia(t.db, [character], owner)).find((m) => m.id === out.pictures[0].id)?.aspect).toBe("9:16");
    // Nothing picked: the Studio's portrait, as always.
    await post({ action: "shoot", character_id: character, choices: {} }, cookie);
    expect(edits.at(-1)!.aspect_ratio).toBe("3:4");
    // Seedream has no 4:5: it's asked 3:4 and the picture is cut to 4:5.
    const feed = await (await post({ action: "shoot", character_id: character, choices: {}, format: "feed", model: "seedream-v5-pro-edit" }, cookie)).json();
    expect(edits.at(-1)!.aspect_ratio).toBe("3:4");
    const cut = (await t.db.query<{ data: Buffer | null; object_key: string | null }>(`select data, object_key from adult_images where id = $1`, [feed.pictures[0].id])).rows[0];
    expect(await dims((await readBytes(cut))!)).toEqual([300, 375]);
  });

  it("makes a carousel of one picture: its moment from six angles, in the feed's 4:5, for a token", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    const edits = await fakeVenice();
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 5, 'test')`, [crypto.randomUUID(), owner]);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, level) values ('pic-1', $1, $2, 'scene', 'p', 'image/png', $3, 'ready', 1)`, [owner, character, await png(300, 400)]);
    const out = await (await post({ action: "carousel", character_id: character, image_id: "pic-1" }, cookie)).json();
    expect(out.shoot).toMatchObject({ kind: "carousel", asked: 6, made: 6, tokens: 1 });
    expect(edits).toHaveLength(6);
    expect(edits.every((e) => e.aspect_ratio === "4:5" && /\/media\/face-1\?until=/.test(e.images[0]) && e.images.at(-1)!.includes("/media/pic-1?until="))).toBe(true);
    expect(new Set(edits.map((e) => e.prompt)).size).toBe(6);
    expect(edits[0].prompt).toContain("at the very moment in Picture 2");
    // Its level is the picture's, and it's kept on each.
    const rows = (await t.db.query<{ level: number; aspect: string }>(`select level, aspect from adult_images where shoot_id = $1`, [out.shoot.id])).rows;
    expect(rows.every((r) => r.level === 1 && r.aspect === "4:5")).toBe(true);
    // Not theirs: not found.
    expect((await post({ action: "carousel", character_id: character, image_id: "nope" }, cookie)).status).toBe(404);
  });

  it("fixes faces in the original's shape", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const edits = await fakeVenice();
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, level, aspect) values ('wide-1', $1, $2, 'scene', 'p', 'image/png', $3, 'ready', 0, '16:9')`, [owner, character, await png(400, 225)]);
    const res = await fixPost(new Request(`${BASE_URL}/api/admin/after-dark/fix-faces`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ media_id: "wide-1" }) }));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(edits[0].aspect_ratio).toBe("16:9");
    const row = (await t.db.query<{ aspect: string; data: Buffer | null; object_key: string | null }>(`select aspect, data, object_key from adult_images where id = $1`, [out.picture.id])).rows[0];
    expect(row.aspect).toBe("16:9");
    expect(await dims((await readBytes(row))!)).toEqual([300, 169]);
  });
});

describe("the PG Studio's native sizes and carousels", () => {
  async function pgVenice(answers: string[] = ["CLOTHED"]) {
    const portrait = await png(300, 400);
    const drawn: { url: string; body: Record<string, unknown> }[] = [];
    setPgStudioFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      drawn.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(new Uint8Array(portrait), { headers: { "content-type": "image/png" } });
    });
    let i = 0;
    setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing: answers[i++ % answers.length], age: "ADULTS" }) } }] }));
    return drawn;
  }
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const pg = (id: string, body: unknown, cookie: string) =>
    pgPost(new Request(`${BASE_URL}/api/characters/${id}/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }), params(id));
  async function pgOwner() {
    const uid = crypto.randomUUID();
    const cookie = signedInCookie(uid);
    const id = (await (await api.createCharacter(validCharacter({ name: `Pia ${uid.slice(0, 6)}` }), cookie)).json()).id as string;
    return { uid, cookie, id };
  }
  beforeEach(async () => {
    await saveAdultSettings(t.db, { venice_key: "placeholder-venice", studio: { pg: { open_to: "everyone" } } });
  });

  it("draws a shoot of someone with no portrait at an aspect ratio, never a width and height (Qwen Image 3 refuses those)", async () => {
    const me = await pgOwner();
    const drawn = await pgVenice();
    const r = await (await pg(me.id, { action: "shoot", choices: { shot: "candid" }, format: "square" }, me.cookie)).json();
    expect(r.shoot.made).toBe(4);
    expect(drawn[0].url).toMatch(/\/image\/generate$/);
    expect(drawn[0].body).toMatchObject({ model: "qwen-image-3", aspect_ratio: "1:1" });
    expect(drawn[0].body.width).toBeUndefined();
    const row = (await t.db.query<{ aspect: string; data: Buffer | null; object_key: string | null }>(`select aspect, data, object_key from studio_pg_pictures where id = $1`, [r.pictures[0].id])).rows[0];
    expect(row.aspect).toBe("1:1");
    expect(await dims((await readBytes(row))!)).toEqual([300, 300]);
  });

  it("makes a carousel of one of their pictures from their portrait and the picture itself, for its price", async () => {
    const me = await pgOwner();
    await claimAdmin(t.db, me.uid);
    const drawn = await pgVenice(["CLOTHED"]);
    const shot = await (await pg(HOUSE_CHARACTERS[0].id, { action: "shoot", choices: { shot: "candid" } }, me.cookie)).json();
    const before = drawn.length;
    const r = await (await pg(HOUSE_CHARACTERS[0].id, { action: "carousel", picture_id: shot.pictures[0].id }, me.cookie)).json();
    expect(r.shoot).toMatchObject({ asked: 6, made: 6, tokens: 0 });
    const calls = drawn.slice(before);
    expect(calls).toHaveLength(6);
    expect(calls.every((d) => d.url.endsWith("/image/multi-edit") && d.body.aspect_ratio === "4:5" && d.body.safe_mode === true)).toBe(true);
    // The house portrait, then the picture itself as data (a provider can't open the picture's own link).
    expect(String((calls[0].body.images as string[])[0])).toMatch(/\/cast\/house-.*\.webp$/);
    expect(String((calls[0].body.images as string[])[1])).toMatch(/^data:image\/png;base64,/);
    const kind = (await t.db.query<{ kind: string }>(`select kind from studio_pg_shoots where id = $1`, [r.shoot.id])).rows[0].kind;
    expect(kind).toBe("carousel");
    // Someone else's picture: not found.
    const other = await pgOwner();
    expect((await pg(other.id, { action: "carousel", picture_id: shot.pictures[0].id }, other.cookie)).status).toBe(404);
  });
});

describe("the shape chips", () => {
  it("offer every format, the picked one checked, and give a tile its shape", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: FormatChips, tileRatio } = await import("@/app/studio/FormatChips");
    const html = renderToStaticMarkup(createElement(FormatChips, { value: "story", onChange: () => {} }));
    for (const f of FORMATS) expect(html).toContain(f.label);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(tileRatio("9:16")).toBe("9 / 16");
    expect(tileRatio("3:4")).toBeUndefined();
    expect(tileRatio(null)).toBeUndefined();
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { GET as fixGet, POST as fixPost } from "@/app/api/admin/after-dark/fix/route";
import { crossesTaboo } from "@/lib/adult/acts";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import {
  changePrompt,
  cleanSpot,
  featherFor,
  FIXES_MAX,
  levelOfWords,
  pasteSpot,
  repairPrompt,
  REPAIRS,
  spotBoxes,
  SPOT_MIN,
  undressPrompt,
} from "@/lib/adult/fix";
import { characterMedia, mediaBytes, setMediaFetchForTests } from "@/lib/adult/media";
import { ALONE_QUESTION, setModerationFetchForTests, VENICE_CHAT } from "@/lib/adult/moderation";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setStudioPausesForTests } from "@/lib/adult/studio";
import { EMPTY_PLACE } from "@/lib/adult/studio-catalog";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pairKey } from "@/lib/relationships";
import { checkAdultText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Fix (lib/adult/fix.ts; David, 2026-11-09: "we need a way to iterate over a broken image and fix it"). No live calls:
// Venice, Hive and the alone check are stubbed. Explicit output isn't made here: the models are stubs.

/** Words that read young: none may reach a picture model (on top of checkAdultText). */
const YOUNG = /\b(teen\w*|young\w*|girl\w*|boy\w*|school\w*|student\w*|petite|little|tiny|child\w*|kid\w*|underage|minor\w*)\b/i;
const clean = (p: string) => {
  expect(checkAdultText({ words: p }).ok, p).toBe(true);
  expect(crossesTaboo(p), p).toBe(false);
  expect(YOUNG.test(p), p).toBe(false);
  expect(p).toContain("Everyone shown is an adult.");
  expect(p.length).toBeLessThanOrEqual(1500);
};

describe("a fix's prompts", () => {
  it("repair what's broken (chips, then their words), keep the rest, and never take it past Picture 1", () => {
    const whole = repairPrompt(["hands", "limbs"], "her left hand has six fingers.", 0);
    expect(whole).toMatch(/^Picture 1 is the photograph to keep exactly as it is, but for what's wrong in it\./);
    expect(whole).toContain(`Put right ${REPAIRS.hands.words}; and ${REPAIRS.limbs.words}; and her left hand has six fingers.`);
    expect(whole).toContain("Change nothing else");
    expect(whole).toContain("Exactly as dressed as in Picture 1.");
    clean(whole);
    const close = repairPrompt(["glitches"], null, 2, true);
    expect(close).toMatch(/^Picture 1 is a close-up cut from a photograph\./);
    expect(close).toContain("so it fits back into the photograph");
    expect(close).toContain("exactly as explicit as Picture 1 and no more");
    clean(close);
  });

  it("change one thing in their words; undress the ones asked, with their nude body, the rest as dressed as before", () => {
    const change = changePrompt("make the lamp light warmer!", 1);
    expect(change).toContain("The change: make the lamp light warmer.");
    expect(change).toContain("Exactly as dressed as in Picture 1.");
    clean(change);
    const one = undressPrompt([{ tag: "the woman", body: 2 }], ["the man"], 0, false);
    expect(one).toMatch(/^Picture 1 is the photograph to keep exactly as it is, but with the woman undressed: no clothes at all\./);
    expect(one).toContain("The woman's body is the body from Picture 2.");
    expect(one).toContain("The man stays exactly as dressed as in Picture 1.");
    expect(one).toContain("Nude, with nothing sexual or explicit added.");
    expect(one).not.toContain(EMPTY_PLACE);
    clean(one);
    const outside = undressPrompt([{ tag: "the man", body: null }], [], 1, true);
    expect(outside).toContain(`${EMPTY_PLACE}.`);
    expect(outside).not.toContain("Picture 2");
    clean(outside);
    const both = undressPrompt([{ tag: "the woman", body: null }, { tag: "the man", body: 2 }], [], 3, false);
    expect(both).toContain("but with both of them undressed");
    expect(both).toContain("The man's body is the body from Picture 2.");
    expect(both).toContain("exactly as explicit as Picture 1 and no more");
    clean(both);
  });

  it("read how far their words would take a picture, and not a strip of light or a cowgirl hat", () => {
    const cases: [string, number][] = [
      ["her left hand has six fingers", 0],
      ["make the lamp warmer", 0],
      ["a strip of light across the wall", 0],
      ["give her a cowgirl hat", 0],
      ["the sheer curtains behind them", 0],
      ["bare skin on her shoulders", 0],
      ["put her in lingerie", 1],
      ["a red bikini", 1],
      ["take her dress off", 2],
      ["make her naked", 2],
      ["topless", 2],
      ["without her shirt", 2],
      ["strip her down", 2],
      ["make them have sex", 3],
    ];
    for (const [words, level] of cases) expect([words, levelOfWords(words)]).toEqual([words, level]);
  });
});

describe("a marked spot", () => {
  it("is made sane: inside the picture, big enough, and nearly all of it is the whole picture", () => {
    expect(cleanSpot(null)).toEqual({ spot: null, error: null });
    expect(cleanSpot({ x: Number.NaN, y: 0, w: 0.2, h: 0.2 }).error).toBeTruthy();
    expect(cleanSpot({ x: 0.5, y: 0.5, w: SPOT_MIN / 2, h: 0.3 }).error).toMatch(/bigger spot/);
    expect(cleanSpot({ x: 0.9, y: 0.8, w: 0.5, h: 0.5 })).toEqual({ spot: { x: 0.9, y: 0.8, w: expect.closeTo(0.1, 6), h: expect.closeTo(0.2, 6) }, error: null });
    expect(cleanSpot({ x: 0, y: 0, w: 1, h: 0.95 })).toEqual({ spot: null, error: null });
  });

  it("is cut with room round it, kept inside the picture", () => {
    expect(spotBoxes(200, 160, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).toEqual({
      spot: { left: 80, top: 64, width: 40, height: 32 },
      piece: { left: 48, top: 32, width: 104, height: 96 },
    });
    const corner = spotBoxes(1000, 1000, { x: 0, y: 0.8, w: 0.3, h: 0.2 });
    expect(corner.spot).toEqual({ left: 0, top: 800, width: 300, height: 200 });
    expect(corner.piece).toEqual({ left: 0, top: 695, width: 405, height: 305 });
  });

  it("is pasted back with a soft edge: the spot fixed, everything past the edge the original's own pixels", async () => {
    const W = 200;
    const H = 160;
    const original = await patterned(W, H);
    const { spot, piece } = spotBoxes(W, H, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
    const fixed = await solid(52, 48, [255, 0, 0]);
    const out = await pasteSpot(original, fixed, piece, spot);
    expect(out.mime).toBe("image/png");
    const before = await rgb(original);
    const after = await rgb(out.bytes);
    const feather = featherFor(spot);
    expect(feather).toBe(4);
    let untouched = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x < spot.left ? spot.left - x : x >= spot.left + spot.width ? x - (spot.left + spot.width) + 1 : 0;
        const dy = y < spot.top ? spot.top - y : y >= spot.top + spot.height ? y - (spot.top + spot.height) + 1 : 0;
        const d = Math.hypot(dx, dy);
        if (d === 0) expect(after.at(x, y), `${x},${y}`).toEqual([255, 0, 0]);
        else if (d >= feather) {
          expect(after.at(x, y), `${x},${y}`).toEqual(before.at(x, y));
          untouched++;
        }
      }
    }
    expect(untouched).toBeGreaterThan(W * H - (spot.width + 2 * feather) * (spot.height + 2 * feather));
    // In the edge, between the two.
    const mid = after.at(spot.left - 2, spot.top + 10);
    const was = before.at(spot.left - 2, spot.top + 10);
    expect(mid[0]).toBeGreaterThan(was[0]);
    expect(mid[0]).toBeLessThan(255);
    // A JPEG stays a JPEG.
    const jpeg = await sharp(original).jpeg({ quality: 95 }).toBuffer();
    expect((await pasteSpot(jpeg, fixed, piece, spot)).mime).toBe("image/jpeg");
  });
});

/* ------------------------------------------------------ the route ------------------------------------------------------ */

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
  setModerationFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
  setStudioPausesForTests(true);
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.9 }] }] };
const answer = (a: string) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: a }) } }] });
function fakeHive(age = "ADULTS") {
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? answer(age) : CLEAN_MOD));
}
/** Venice's multi-edit, stubbed: what each was sent; it answers with `reply`'s bytes (a placeholder, else a real PNG). */
function fakeVenice(reply: () => Promise<Uint8Array> | Uint8Array = () => PNG) {
  const edits: { prompt: string; images: string[] }[] = [];
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).endsWith("/image/multi-edit")) return new Response("?", { status: 500 });
    const body = JSON.parse(String(init?.body ?? "{}"));
    edits.push({ prompt: body.prompt, images: body.images });
    return new Response(new Uint8Array(await reply()), { headers: { "content-type": "image/png" } });
  });
  return edits;
}
/** The alone check (lib/adult/moderation.ts aloneInPicture), answering in turn; anything else an adult. */
function fakeAlone(answers: string[]) {
  const asked: string[] = [];
  setModerationFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (String(input) === VENICE_CHAT && body.messages?.[0]?.content?.[0]?.text === ALONE_QUESTION) {
      asked.push(ALONE_QUESTION);
      return Response.json(answer(answers[asked.length - 1] ?? "ONE"));
    }
    return Response.json(answer("ADULTS"));
  });
  return asked;
}

const fix = (body: unknown, cookie: string) =>
  fixPost(new Request(`${BASE_URL}/api/admin/after-dark/fix`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const fixed = async (body: unknown, cookie: string) => {
  const res = await fix(body, cookie);
  const out = await res.json();
  expect(res.status, JSON.stringify(out)).toBe(200);
  return out;
};
const state = async (id: string, cookie: string) => fixGet(new Request(`${BASE_URL}/api/admin/after-dark/fix?media_id=${id}`, { headers: { cookie } }));

/** After Dark on, with Venice and Hive; an owner (admin or a subscriber) with a character switched in and a face to keep. */
async function setup(opts: { admin?: boolean; pronouns?: string } = {}) {
  const raw = newUserCookie();
  const owner = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: opts.pronouns ?? "she/her", age: 24 }), raw)).json()) as { id: string };
  if (opts.admin) await claimAdmin(t.db, owner);
  else await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [owner]);
  await saveAdultSettings(t.db, {
    enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", auto_scene_pictures: false,
    ...(opts.admin ? {} : { studio: { open_to: "entitled" } }),
  });
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, character.id]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [owner, character.id, Buffer.from(PNG)]);
  return { owner, cookie: signedInCookie(owner), character: character.id };
}
/** A picture of theirs, as a night or a shoot keeps one. */
async function picture(owner: string, a: string, b: string | null, opts: { level?: number; place?: string | null; bytes?: Buffer; prompt?: string } = {}) {
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, level, scene_place) values ($1, $2, $3, $4, 'scene', $5, 'image/png', $6, 'ready', $7, $8)`,
    [id, owner, a, b, opts.prompt ?? "on the sofa by the window, smiling", opts.bytes ?? Buffer.from(PNG), opts.level ?? 0, opts.place ?? null],
  );
  return id;
}
/** Their Studio limits for one character (adult_identity): its intensity and hard nos. */
const limits = (owner: string, character: string, intensity: string, hardNos: string[] = []) =>
  t.db.query(`insert into adult_identity (owner_id, character_id, intensity, hard_nos) values ($1, $2, $3, $4::jsonb) on conflict (owner_id, character_id) do update set intensity = excluded.intensity, hard_nos = excluded.hard_nos`, [
    owner, character, intensity, JSON.stringify(hardNos),
  ]);
const tokensOf = (uid: string, n: number) => t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), uid, n]);
const usedTokens = async (who: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [who])).rows[0]?.used ?? 0;
type FixRow = { fixed_from: string; fix_root: string; fix_kind: string; fix_note: string | null; fix_spot: unknown; level: number; superseded_by: string | null };
const rowOf = async (id: string) =>
  (await t.db.query<FixRow>(`select fixed_from, fix_root, fix_kind, fix_note, fix_spot, level, superseded_by from adult_images where id = $1`, [id])).rows[0];

describe("Fix: repair and change", () => {
  it("repairs the whole picture from the chips and their words, keeps it beside the original, and says what's left", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const edits = fakeVenice();
    const pic = await picture(owner, character, null, { level: 1 });
    const out = await fixed({ media_id: pic, kind: "repair", repairs: ["hands", "hands", "eyes"], note: "her left hand has six fingers" }, cookie);
    expect(out.original).toBe(pic);
    expect(out.root).toBe(pic);
    expect(edits).toHaveLength(1);
    expect(edits[0].images).toHaveLength(1);
    expect(edits[0].images[0]).toContain(`/media/${pic}.png?until=`);
    expect(edits[0].prompt).toContain(`Put right ${REPAIRS.hands.words}; and ${REPAIRS.eyes.words}; and her left hand has six fingers.`);
    expect(edits[0].prompt).toContain("Exactly as dressed as in Picture 1.");
    expect(await rowOf(out.picture.id)).toMatchObject({ fixed_from: pic, fix_root: pic, fix_kind: "repair", fix_note: "her left hand has six fingers", fix_spot: null, level: 1 });
    expect(out.state).toMatchObject({ root: pic, left: FIXES_MAX - 1, undress: { ok: true, price: 0 }, blocked: null, kept: null });
    expect(out.state.versions.map((v: { id: string; kind: string | null; from: string | null }) => [v.id, v.kind, v.from])).toEqual([
      [pic, null, null],
      [out.picture.id, "repair", pic],
    ]);
    // Chips alone keep the chips as its note.
    const chips = await fixed({ media_id: pic, kind: "repair", repairs: ["limbs", "glitches"] }, cookie);
    expect((await rowOf(chips.picture.id)).fix_note).toBe("limbs,glitches");
  });

  it("fixes just a marked spot: the piece close up, pasted back so the rest is the original's own pixels", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const edits = fakeVenice(() => solid(256, 256, [255, 0, 0]));
    const W = 300;
    const H = 400;
    const original = await patterned(W, H);
    const pic = await picture(owner, character, null, { bytes: original });
    const spot = { x: 0.4, y: 0.5, w: 0.2, h: 0.15 };
    const out = await fixed({ media_id: pic, kind: "change", note: "make her bracelet gold", spot }, cookie);
    expect(edits).toHaveLength(1);
    expect(edits[0].images).toHaveLength(1);
    expect(edits[0].images[0]).toMatch(/^data:image\/png;base64,/);
    expect(edits[0].prompt).toMatch(/^Picture 1 is a close-up cut from a photograph\./);
    expect(edits[0].prompt).toContain("The change: make her bracelet gold.");
    // The piece sent is the spot with room round it.
    const boxes = spotBoxes(W, H, spot);
    const sent = await sharp(Buffer.from(edits[0].images[0].split(",")[1], "base64")).metadata();
    expect([sent.width, sent.height]).toEqual([boxes.piece.width, boxes.piece.height]);
    // Outside the piece, every pixel is the original's; inside the spot, the fix.
    const bytes = (await mediaBytes(t.db, out.picture.id, owner))!.data;
    const before = await rgb(original);
    const after = await rgb(bytes);
    const p = boxes.piece;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) if (x < p.left || x >= p.left + p.width || y < p.top || y >= p.top + p.height) expect(after.at(x, y)).toEqual(before.at(x, y));
    expect(after.at(boxes.spot.left + 5, boxes.spot.top + 5)).toEqual([255, 0, 0]);
    expect((await rowOf(out.picture.id)).fix_spot).toEqual(spot);
    // A spot too small to fix is refused before anything's drawn.
    const tiny = await fix({ media_id: pic, kind: "repair", repairs: ["hands"], spot: { x: 0.1, y: 0.1, w: 0.01, h: 0.2 } }, cookie);
    expect([tiny.status, (await tiny.json()).error]).toEqual([422, "bad_spot"]);
    expect(edits).toHaveLength(1);
  });

  it("refuses words past the picture's level, over their limits or over the lines, before anything's drawn", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const edits = fakeVenice();
    await limits(owner, character, "explicit", ["pain"]);
    const dressed = await picture(owner, character, null, { level: 0 });
    const nude = await picture(owner, character, null, { level: 2 });
    const refused = async (media_id: string, note: string) => {
      const res = await fix({ media_id, kind: "change", note }, cookie);
      return [res.status, (await res.json()).error];
    };
    expect(await refused(dressed, "take her dress off")).toEqual([422, "undress_instead"]);
    expect(await refused(dressed, "make her naked")).toEqual([422, "undress_instead"]);
    expect(await refused(dressed, "put her in lingerie")).toEqual([422, "past_level"]);
    expect(await refused(dressed, "make them have sex")).toEqual([422, "past_level"]);
    expect(await refused(nude, "make them have sex")).toEqual([422, "past_level"]);
    expect(await refused(dressed, "make her look sixteen")).toEqual([422, "not_allowed"]);
    expect(await refused(dressed, "a schoolgirl outfit")).toEqual([422, "not_allowed"]);
    const hard = await fix({ media_id: dressed, kind: "change", note: "have her spank him" }, cookie);
    expect(hard.status).toBe(422);
    expect((await hard.json()).message).toContain("crossed a hard limit (Pain)");
    // Nothing asked, or no words for a change.
    expect((await fix({ media_id: dressed, kind: "repair" }, cookie)).status).toBe(422);
    expect((await fix({ media_id: dressed, kind: "change", note: "  " }, cookie)).status).toBe(422);
    expect((await fix({ media_id: dressed, kind: "repair", repairs: ["wings"] }, cookie)).status).toBe(422);
    expect(edits).toHaveLength(0);
    // Within the picture's level, it's made.
    await fixed({ media_id: nude, kind: "change", note: "her hair down over one shoulder" }, cookie);
    expect(edits).toHaveLength(1);
  });

  it("won't remake a picture past what they're held to now", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const edits = fakeVenice();
    const pic = await picture(owner, character, null, { level: 3 });
    await limits(owner, character, "spicy");
    const res = await fix({ media_id: pic, kind: "repair", repairs: ["hands"] }, cookie);
    expect([res.status, (await res.json()).error]).toEqual([422, "past_limits"]);
    const s = (await (await state(pic, cookie)).json()).state;
    expect(s.blocked).toMatch(/Mara's limits stop at nude now/);
    expect(edits).toHaveLength(0);
  });
});

describe("Fix: versions and Keep", () => {
  it("makes each fix a version, fixes from any of them, keeps one in the gallery and the night's beats, and stops at the most", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    fakeVenice();
    const pic = await picture(owner, character, null);
    const house = HOUSE_CHARACTERS[0].id;
    const [a, b] = pairKey(character, house);
    await t.db.query(
      `insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, status, picture_id) values ('beat-1', $1, 'scene-1', $2, $3, 1, 4, 'kiss', 'moment', 2, 'drawn', $4)`,
      [owner, a, b, pic],
    );
    const one = (await fixed({ media_id: pic, kind: "repair", repairs: ["hands"] }, cookie)).picture.id as string;
    const two = await fixed({ media_id: one, kind: "change", note: "the lamp light warmer" }, cookie);
    expect(await rowOf(two.picture.id)).toMatchObject({ fixed_from: one, fix_root: pic, fix_kind: "change" });
    expect(two.state.versions.map((v: { id: string; from: string | null; shown: boolean }) => [v.id, v.from, v.shown])).toEqual([
      [pic, null, true],
      [one, pic, true],
      [two.picture.id, one, true],
    ]);
    const gallery = async () => (await characterMedia(t.db, character, owner)).map((m) => m.id);
    expect(await gallery()).toEqual(expect.arrayContaining([pic, one, two.picture.id]));
    const beat = async () => (await t.db.query<{ picture_id: string }>(`select picture_id from adult_beats where id = 'beat-1'`)).rows[0].picture_id;

    // Keep the second fix: the others leave the gallery, the beat shows it.
    const kept = await fixed({ action: "keep", media_id: two.picture.id }, cookie);
    expect(kept.kept).toBe(two.picture.id);
    expect(kept.hidden.sort()).toEqual([pic, one].sort());
    expect(kept.state.versions.map((v: { shown: boolean }) => v.shown)).toEqual([false, false, true]);
    expect(kept.state.kept).toBe(two.picture.id);
    // A fix made from the kept one is shown beside it (in the gallery too) until one of them is kept.
    const three = await fixed({ media_id: two.picture.id, kind: "repair", repairs: ["eyes"] }, cookie);
    expect(three.state.kept).toBe(two.picture.id);
    expect(three.state.versions.filter((v: { shown: boolean }) => v.shown).map((v: { id: string }) => v.id)).toEqual([two.picture.id, three.picture.id]);
    expect(await gallery()).toEqual(expect.arrayContaining([two.picture.id, three.picture.id]));
    expect((await fixed({ action: "keep", media_id: two.picture.id }, cookie)).state.versions.filter((v: { shown: boolean }) => v.shown)).toHaveLength(1);
    expect(await gallery()).toContain(two.picture.id);
    expect(await gallery()).not.toContain(pic);
    expect(await gallery()).not.toContain(one);
    expect(await beat()).toBe(two.picture.id);
    expect((await rowOf(pic)).superseded_by).toBe(two.picture.id);

    // Back to the original: as before any fix.
    const back = await fixed({ action: "keep", media_id: pic }, cookie);
    expect(back.hidden.sort()).toEqual([one, two.picture.id, three.picture.id].sort());
    expect(back.state.kept).toBe(pic);
    expect(await gallery()).toContain(pic);
    expect(await gallery()).not.toContain(two.picture.id);
    expect(await beat()).toBe(pic);
    expect((await rowOf(pic)).superseded_by).toBeNull();

    // The most for one original, across all its versions.
    for (let i = 3; i < FIXES_MAX; i++) await fixed({ media_id: two.picture.id, kind: "repair", repairs: ["glitches"] }, cookie);
    const over = await fix({ media_id: one, kind: "repair", repairs: ["hands"] }, cookie);
    expect([over.status, (await over.json()).error]).toEqual([409, "too_many"]);
    expect((await (await state(pic, cookie)).json()).state.left).toBe(0);
  });

  it("is the owner's alone: someone else's picture, or a video, is not found", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    const edits = fakeVenice();
    const pic = await picture(owner, character, null);
    const stranger = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [stranger]);
    expect((await fix({ media_id: pic, kind: "repair", repairs: ["hands"] }, signedInCookie(stranger))).status).toBe(404);
    expect((await state(pic, signedInCookie(stranger))).status).toBe(404);
    expect((await fix({ action: "keep", media_id: pic }, signedInCookie(stranger))).status).toBe(404);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ('vid-1', $1, $2, 'video', 'p', 'video/mp4', $3, 'ready')`, [owner, character, Buffer.from(PNG)]);
    expect((await fix({ media_id: "vid-1", kind: "repair", repairs: ["hands"] }, cookie)).status).toBe(404);
    // Not signed in to After Dark at all: not found either.
    expect((await state(pic, newUserCookie())).status).toBe(404);
    expect(edits).toHaveLength(0);
    // Free for a subscriber, counted against the month's pictures.
    await fixed({ media_id: pic, kind: "repair", repairs: ["hands"] }, cookie);
    expect(await usedTokens(owner)).toBe(0);
    expect((await t.db.query<{ pictures: number }>(`select pictures from adult_usage where owner_id = $1`, [owner])).rows[0].pictures).toBe(1);
  });
});

describe("Fix: Undressed", () => {
  it("costs a subscriber the Studio's price, sends their nude body, makes it nude, and gives the token back if it's not kept", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    const edits = fakeVenice();
    const pic = await picture(owner, character, null, { level: 1, place: "her bedroom" });
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, attire) values ('body-1', $1, $2, 'baseline', 'p', 'image/png', $3, 'ready', 'nude')`, [owner, character, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_identity (owner_id, character_id, body_image_id) values ($1, $2, 'body-1')`, [owner, character]);
    const s = (await (await state(pic, cookie)).json()).state;
    expect(s.undress).toEqual({ ok: true, why: null, price: 1, empty_place: false });
    const broke = await fix({ media_id: pic, kind: "undress" }, cookie);
    expect([broke.status, (await broke.json()).error]).toEqual([402, "needs_tokens"]);
    expect(edits).toHaveLength(0);
    await tokensOf(owner, 3);
    const out = await fixed({ media_id: pic, kind: "undress" }, cookie);
    expect(await usedTokens(owner)).toBe(1);
    expect(edits[0].images).toHaveLength(2);
    expect(edits[0].images[1]).toContain("/media/body-1.png?until=");
    expect(edits[0].prompt).toContain("but with the woman undressed: no clothes at all.");
    expect(edits[0].prompt).toContain("The woman's body is the body from Picture 2.");
    expect(edits[0].prompt).toContain("Nude, with nothing sexual or explicit added.");
    expect(edits[0].prompt).not.toContain(EMPTY_PLACE);
    expect(await rowOf(out.picture.id)).toMatchObject({ fix_kind: "undress", level: 2, fix_note: null });
    // Discarded by the check: nothing kept, the token back.
    fakeHive("MINOR");
    const discarded = await fix({ media_id: pic, kind: "undress" }, cookie);
    expect(discarded.status).toBe(422);
    expect((await discarded.json()).message).toMatch(/Your tokens are back\.$/);
    expect(await usedTokens(owner)).toBe(1);
  });

  it("is free for an admin, and stays locked where their limits stop short of nude", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const edits = fakeVenice();
    const pic = await picture(owner, character, null);
    await limits(owner, character, "flirty");
    const s = (await (await state(pic, cookie)).json()).state;
    expect(s.undress.ok).toBe(false);
    expect(s.undress.why).toMatch(/Mara's limits stop at suggestive/);
    const locked = await fix({ media_id: pic, kind: "undress" }, cookie);
    expect([locked.status, (await locked.json()).error]).toEqual([422, "locked"]);
    expect(edits).toHaveLength(0);
    await limits(owner, character, "spicy");
    await fixed({ media_id: pic, kind: "undress" }, cookie);
    expect(await usedTokens(owner)).toBe(0);
  });

  it("somewhere public: alone only with the place empty, checked (failing closed); never the two of them", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const edits = fakeVenice();
    const beach = await picture(owner, character, null, { place: "the beach" });
    expect((await (await state(beach, cookie)).json()).state.undress).toMatchObject({ ok: true, empty_place: true });
    const asked = fakeAlone(["ONE", "MORE"]);
    await fixed({ media_id: beach, kind: "undress" }, cookie);
    expect(edits.at(-1)!.prompt).toContain(`${EMPTY_PLACE}.`);
    expect(asked).toHaveLength(1);
    const crowd = await fix({ media_id: beach, kind: "undress" }, cookie);
    expect([crowd.status, (await crowd.json()).error]).toEqual([422, "not_alone"]);
    expect((await t.db.query<{ reason: string }>(`select reason from adult_rejections where kind = 'fix'`)).rows[0].reason).toBe("someone else was in the picture, somewhere public");
    // A nude one there, changed: checked for anyone else too.
    const nude = await picture(owner, character, null, { level: 2, place: "the beach" });
    fakeAlone(["MORE"]);
    expect((await fix({ media_id: nude, kind: "change", note: "her hair down over one shoulder" }, cookie)).status).toBe(422);
    // The alone check can't run: not kept.
    setModerationFetchForTests(async () => new Response("down", { status: 500 }));
    const down = await fix({ media_id: beach, kind: "undress" }, cookie);
    expect([down.status, (await down.json()).error]).toEqual([503, "not_alone"]);
    // The two of them somewhere public: never.
    const house = HOUSE_CHARACTERS[0].id;
    const [a, b] = pairKey(character, house);
    const pair = await picture(owner, a, b, { place: "the beach" });
    expect((await (await state(pair, cookie)).json()).state.undress.ok).toBe(false);
    const n = edits.length;
    const both = await fix({ media_id: pair, kind: "undress" }, cookie);
    expect([both.status, (await both.json()).error]).toEqual([422, "public"]);
    expect(edits).toHaveLength(n);
    // Somewhere private, the two of them can be.
    const home = await picture(owner, a, b, { place: "her bedroom" });
    await fixed({ media_id: home, kind: "undress" }, cookie);
    expect(edits.at(-1)!.prompt).toContain("but with both of them undressed");
  });
});

/* ------------------------------------------------------ pictures ------------------------------------------------------ */

async function solid(w: number, h: number, c: [number, number, number]): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } }).png().toBuffer();
}
/** A picture where every pixel differs from its neighbours, so a moved or blurred pixel shows. */
async function patterned(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 7 + y * 3) % 256, (x * 3 + y * 11) % 256, (x * y) % 256], (y * w + x) * 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
async function rgb(bytes: Buffer) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { at: (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]) };
}

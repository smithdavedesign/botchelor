import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as studioPost, GET as studioGet } from "@/app/api/admin/after-dark/studio/route";
import { POST as fixPost } from "@/app/api/admin/after-dark/fix-faces/route";
import { POST as pgPost, GET as pgGet } from "@/app/api/characters/[id]/studio/route";
import { crossesTaboo } from "@/lib/adult/acts";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { FIXES_MAX, fixFacePrompt } from "@/lib/adult/fix-faces";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setFaceReference } from "@/lib/adult/steering";
import { setStudioPausesForTests } from "@/lib/adult/studio";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pairKey } from "@/lib/relationships";
import { checkAdultText, checkPgPictureText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { faceKey, setPgStudioFetchForTests, setPgStudioPausesForTests } from "@/lib/studio/pg";
import { IDENTITY_VIEW_IDS, IDENTITY_VIEWS, identityPrice, identityViewPrompt, pickView, viewFor } from "@/lib/studio/identity-views";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Fix faces and the identity pack (the creator suite, 2026-10-26: lib/adult/fix-faces.ts, lib/studio/identity-*.ts).
// No live calls: Venice, Replicate, Hive and the PG check are stubbed.

/** Words that read young: none may reach a picture model (on top of checkAdultText). */
const YOUNG = /\b(teen\w*|young\w*|girl\w*|boy\w*|school\w*|student\w*|petite|little|tiny|child\w*|kid\w*|underage|minor\w*)\b/i;

describe("the identity pack's views", () => {
  it("are eight, each its own angle of the same adult from Picture 1, one person, to the lines in both Studios", () => {
    expect(IDENTITY_VIEW_IDS).toHaveLength(8);
    for (const v of IDENTITY_VIEWS) {
      for (const pg of [false, true]) {
        const p = identityViewPrompt(v.id, { noun: "woman", age: 19, look: "long copper-red hair" }, { pg, body: true });
        expect(p).toMatch(/^Make one photograph of the woman from Picture 1/);
        // Never under 21 in the words, whatever their sheet says.
        expect(p).toContain("a 21-year-old adult");
        expect(p).toContain("One person only.");
        expect(p).toContain(v.words.slice(1, 30));
        expect(checkAdultText({ words: p }).ok, p).toBe(true);
        expect(crossesTaboo(p)).toBe(false);
        expect(YOUNG.test(p), p).toBe(false);
        if (pg) {
          expect(p).toContain("safe for work");
          expect(checkPgPictureText({ words: p }).ok, p).toBe(true);
        }
      }
    }
    // The body reference is Picture 2 for the full-body view only.
    expect(identityViewPrompt("full_body", { noun: "man", age: 30, look: "" }, { body: true })).toContain("from Picture 1, with the body from Picture 2");
    expect(identityViewPrompt("front", { noun: "man", age: 30, look: "" }, { body: true })).not.toContain("Picture 2");
    expect(identityViewPrompt("front", { noun: "man", age: 30, look: "" }, { outfit: "a navy suit" })).toContain("Wearing a navy suit.");
  });

  it("pick the view for a picture's angle, the nearest one when it's missing, and price a redraw at its share", () => {
    expect(viewFor("from behind, looking back over her shoulder")).toBe("over_shoulder");
    expect(viewFor("seen in profile against the window")).toBe("profile_left");
    expect(viewFor("full length, head to toe")).toBe("full_body");
    expect(viewFor("a close-up of their faces")).toBe("front");
    expect(viewFor("lying back on the bed")).toBe("three_quarter_left");
    expect(pickView({ over_shoulder: "a", three_quarter_left: "b" }, "from behind")).toEqual({ view: "over_shoulder", id: "a" });
    expect(pickView({ profile_right: "p", three_quarter_left: "b" }, "from behind")).toEqual({ view: "profile_right", id: "p" });
    expect(pickView({ smiling: "s" }, "a close-up")).toEqual({ view: "smiling", id: "s" });
    expect(pickView({}, "anything")).toBeNull();
    expect(identityPrice(2, 8)).toBe(2);
    expect(identityPrice(2, 5)).toBe(2);
    expect(identityPrice(2, 4)).toBe(1);
    expect(identityPrice(2, 1)).toBe(1);
    expect(identityPrice(4, 3)).toBe(2);
    expect(identityPrice(0, 8)).toBe(0);
  });
});

describe("a fix's prompt", () => {
  it("keeps Picture 1 exactly but for the faces, and never adds or takes away what they wear", () => {
    const one = fixFacePrompt("the woman", [], 0);
    expect(one).toMatch(/^Picture 1 is the photograph to keep exactly as it is, but for the woman's face\./);
    expect(one).toContain("Make the woman's face the face from Picture 2");
    expect(one).toContain("Change nothing else");
    expect(one).toContain("Exactly as dressed as in Picture 1.");
    const two = fixFacePrompt("the woman", [{ tag: "the man", from: 3 }], 3);
    expect(two).toContain("but for the faces.");
    expect(two).toContain("Make the man's face the face from Picture 3");
    expect(two).toContain("exactly as explicit as Picture 1");
    expect(checkAdultText({ words: two }).ok).toBe(true);
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
/** Venice's multi-edit, stubbed: what each was sent, and how many ran at once at most. */
function fakeVenice(edit: () => Response = () => new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } })) {
  const edits: { model: string; prompt: string; images: string[] }[] = [];
  const most = { now: 0, max: 0 };
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (!String(input).endsWith("/image/multi-edit")) return new Response("?", { status: 500 });
    edits.push({ model: body.modelId, prompt: body.prompt, images: body.images });
    most.now++;
    most.max = Math.max(most.max, most.now);
    await new Promise((r) => setTimeout(r, 5));
    most.now--;
    return edit();
  });
  return { edits, most };
}

const post = (body: unknown, cookie: string) =>
  studioPost(new Request(`${BASE_URL}/api/admin/after-dark/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const studio = async (cookie: string, id: string) => (await (await studioGet(new Request(`${BASE_URL}/api/admin/after-dark/studio?character=${id}`, { headers: { cookie } }))).json()).state;
const fix = (body: unknown, cookie: string) =>
  fixPost(new Request(`${BASE_URL}/api/admin/after-dark/fix-faces`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));

/** After Dark on, with Venice and Hive; an owner (admin or a subscriber) with a character switched in and a face to keep. */
async function setup(opts: { admin?: boolean } = {}) {
  const raw = newUserCookie();
  const owner = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her", age: 19 }), raw)).json()) as { id: string };
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
async function picture(owner: string, a: string, b: string | null, opts: { id?: string; prompt?: string; level?: number; shoot?: string | null } = {}) {
  const id = opts.id ?? crypto.randomUUID();
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, level, shoot_id) values ($1, $2, $3, $4, 'scene', $5, 'image/png', $6, 'ready', $7, $8)`,
    [id, owner, a, b, opts.prompt ?? "lying back on the bed, smiling", Buffer.from(PNG), opts.level ?? 0, opts.shoot ?? null],
  );
  return id;
}
const tokensOf = (uid: string, n: number) => t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), uid, n]);
const usedTokens = async (who: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [who])).rows[0]?.used ?? 0;

describe("the After Dark identity pack", () => {
  it("draws all eight views from the face they keep, four at a time, free for an admin, and keeps which is which", async () => {
    const { cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits, most } = fakeVenice();
    const res = await post({ action: "identity_pack", character_id: character }, cookie);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.shoot).toMatchObject({ kind: "identity", asked: 8, made: 8, tokens: 0 });
    expect(edits).toHaveLength(8);
    expect(most.max).toBeLessThanOrEqual(4);
    expect(edits.every((e) => /\/media\/face-1\?until=/.test(e.images[0]))).toBe(true);
    expect(edits.map((e) => e.prompt).join(" ")).toContain("looking back over one shoulder");
    const pack = out.state.identity_pack;
    expect(Object.keys(pack).sort()).toEqual([...IDENTITY_VIEW_IDS].sort());
    expect(Object.values(pack).every((v) => !(v as { stale: boolean }).stale)).toBe(true);
    // A redraw of two replaces those two.
    const before = pack.front.id;
    const again = await (await post({ action: "identity_pack", character_id: character, views: ["front", "smiling"] }, cookie)).json();
    expect(again.shoot).toMatchObject({ asked: 2, made: 2 });
    expect(again.state.identity_pack.front.id).not.toBe(before);
    expect(again.state.identity_pack.profile_left.id).toBe(pack.profile_left.id);
  });

  it("costs a subscriber the pack's price, a redraw its share, and gives it back when nothing comes through", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    fakeVenice();
    expect((await post({ action: "identity_pack", character_id: character }, cookie)).status).toBe(402);
    await tokensOf(owner, 10);
    expect((await (await post({ action: "identity_pack", character_id: character }, cookie)).json()).shoot.tokens).toBe(2);
    expect(await usedTokens(owner)).toBe(2);
    expect((await (await post({ action: "identity_pack", character_id: character, views: ["front"] }, cookie)).json()).shoot.tokens).toBe(1);
    expect(await usedTokens(owner)).toBe(3);
    fakeHive("MINOR");
    const refused = await (await post({ action: "identity_pack", character_id: character }, cookie)).json();
    expect(refused).toMatchObject({ refunded: true, shoot: { made: 0, tokens: 0 } });
    expect(await usedTokens(owner)).toBe(3);
  });

  it("sets aside a face anchor and views drawn from an earlier face once they pick another, so shoots use the new face", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    const anchor = await (await post({ action: "face", character_id: character }, cookie)).json();
    await post({ action: "identity_pack", character_id: character, views: ["front"] }, cookie);
    let s = await studio(cookie, character);
    expect(s.identity.faceCrop).toBe(anchor.pictures[0].id);
    expect(s.identity_pack.front.stale).toBe(false);
    // A new face picked.
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-2', $1, $2, 'baseline', 'p', 'image/png', $3)`, [owner, character, Buffer.from(PNG)]);
    expect((await setFaceReference(t.db, owner, character, "face-2")).ok).toBe(true);
    s = await studio(cookie, character);
    expect(s.identity.faceCrop).toBeNull();
    expect(s.identity.faceCropStale).toBe(anchor.pictures[0].id);
    expect(s.identity_pack.front.stale).toBe(true);
    // The next shoot leads with the new face, not the old anchor.
    await post({ action: "shoot", character_id: character, choices: {} }, cookie);
    expect(edits.at(-1)!.images[0]).toMatch(/\/media\/face-2\?until=/);
    // Redrawn from the new face: used again.
    await post({ action: "face", character_id: character }, cookie);
    s = await studio(cookie, character);
    expect(s.identity.faceCrop).toBeTruthy();
    expect(s.identity.faceCropStale).toBeNull();
  });

  it("sends a shoot their face from the angle it needs, last, only when the setting is on and the model has room", async () => {
    const { cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    await post({ action: "identity_pack", character_id: character, views: ["three_quarter_left"] }, cookie);
    const view = (await studio(cookie, character)).identity_pack.three_quarter_left.id as string;
    await post({ action: "shoot", character_id: character, choices: {} }, cookie);
    expect(edits.at(-1)!.images).toHaveLength(1);
    await saveAdultSettings(t.db, { studio: { identity_in_shoots: true } });
    await post({ action: "shoot", character_id: character, choices: {} }, cookie);
    const last = edits.at(-1)!;
    expect(last.images).toHaveLength(2);
    expect(last.images[1]).toContain(`/media/${view}?until=`);
    expect(last.prompt).toContain("Picture 2 is the same woman's face from another angle");
  });
});

describe("Fix faces", () => {
  it("redraws only her face from the face she keeps, checks it, and keeps it beside the original with its tags", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    const seen = fakeHive();
    const { edits } = fakeVenice();
    const pic = await picture(owner, character, null, { level: 2 });
    await t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source) values ($1, $2, 'act', 'kiss', 'choice'), ($1, $2, 'date', 'yes', 'manual')`, [pic, owner]);
    const res = await fix({ media_id: pic }, cookie);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.original).toBe(pic);
    expect(edits).toHaveLength(1);
    expect(edits[0].images[0]).toContain(`/media/${pic}?until=`);
    expect(edits[0].images[1]).toMatch(/\/media\/face-1\?until=/);
    expect(edits[0].prompt).toContain("Make the woman's face the face from Picture 2");
    expect(edits[0].prompt).toContain("exactly as explicit as Picture 1");
    expect(seen).toContain("vlm");
    const row = (await t.db.query<{ fixed_from: string; level: number; kind: string }>(`select fixed_from, level, kind from adult_images where id = $1`, [out.picture.id])).rows[0];
    expect(row).toEqual({ fixed_from: pic, level: 2, kind: "scene" });
    // Its tags, but not the pin for dates (that stays the owner's call).
    const tags = (await t.db.query<{ kind: string }>(`select kind from adult_media_tags where media_id = $1 order by kind`, [out.picture.id])).rows.map((r) => r.kind);
    expect(tags).toEqual(["act"]);
  });

  it("gives each face the identity pack's view that suits the picture, else the face anchor", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    await post({ action: "identity_pack", character_id: character, views: ["over_shoulder"] }, cookie);
    const view = (await studio(cookie, character)).identity_pack.over_shoulder.id as string;
    const behind = await picture(owner, character, null, { prompt: "on the bed from behind, looking back over her shoulder" });
    await fix({ media_id: behind }, cookie);
    expect(edits.at(-1)!.images[1]).toContain(`/media/${view}?until=`);
    // No view for that angle nearby either: the anchor.
    await t.db.query(`delete from identity_views`);
    const anchor = (await (await post({ action: "face", character_id: character }, cookie)).json()).pictures[0].id as string;
    await fix({ media_id: behind }, cookie);
    expect(edits.at(-1)!.images[1]).toContain(`/media/${anchor}?until=`);
  });

  it("fixes the two of them one face at a time, the second from the first's result; through someone's eyes, only the other one", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    const house = HOUSE_CHARACTERS[0].id;
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-h', $1, $2, 'baseline', 'p', 'image/png', $3)`, [owner, house, Buffer.from(PNG)]);
    const [a, b] = pairKey(character, house);
    const both = await picture(owner, a, b, { level: 3 });
    expect((await fix({ media_id: both }, cookie)).status).toBe(200);
    expect(edits).toHaveLength(2);
    expect(edits[0].images[0]).toContain(`/media/${both}?until=`);
    expect(edits[1].images[0]).toMatch(/^data:image\/png;base64,/);
    expect(new Set([edits[0].images[1], edits[1].images[1]].map((u) => u.match(/media\/([^?]+)/)![1]))).toEqual(new Set(["face-1", "face-h"]));
    // Seen through the first one's eyes (in the pair's order): only the second one's face is in it.
    const pov = await picture(owner, a, b, { level: 3 });
    await t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source) values ($1, $2, 'pov', 'a', 'choice')`, [pov, owner]);
    const n = edits.length;
    expect((await fix({ media_id: pov }, cookie)).status).toBe(200);
    expect(edits.length).toBe(n + 1);
    expect(edits.at(-1)!.images[1]).toContain(`/media/${b === character ? "face-1" : "face-h"}?until=`);
  });

  it("is the owner's alone, a picture's at most a few times, held to the check and the month's pictures", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    fakeVenice();
    const pic = await picture(owner, character, null);
    // Someone else's picture, a video, nothing there: not found.
    const stranger = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [stranger]);
    expect((await fix({ media_id: pic }, signedInCookie(stranger))).status).toBe(404);
    expect((await fix({ media_id: "nothing-here" }, cookie)).status).toBe(404);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ('vid-1', $1, $2, 'video', 'p', 'video/mp4', $3, 'ready')`, [owner, character, Buffer.from(PNG)]);
    expect((await fix({ media_id: "vid-1" }, cookie)).status).toBe(404);
    // The check discards one: nothing kept, and the refusal logged.
    fakeHive("MINOR");
    const refused = await fix({ media_id: pic }, cookie);
    expect(refused.status).toBe(422);
    expect((await t.db.query(`select 1 from adult_images where fixed_from = $1`, [pic])).rows).toHaveLength(0);
    expect((await t.db.query<{ kind: string }>(`select kind from adult_rejections`)).rows[0].kind).toBe("fix");
    // Free, but counted: a picture from a night against the month's pictures.
    fakeHive();
    expect((await fix({ media_id: pic }, cookie)).status).toBe(200);
    expect((await t.db.query<{ pictures: number }>(`select pictures from adult_usage where owner_id = $1`, [owner])).rows[0].pictures).toBe(1);
    expect(await usedTokens(owner)).toBe(0);
    for (let i = 1; i < FIXES_MAX; i++) expect((await fix({ media_id: pic }, cookie)).status).toBe(200);
    expect((await fix({ media_id: pic }, cookie)).status).toBe(409);
    // Over the month's pictures: refused before anything's drawn.
    const fresh = await picture(owner, character, null);
    await saveAdultSettings(t.db, { caps: { pictures: 1 } });
    expect((await fix({ media_id: fresh }, cookie)).status).toBe(429);
  });
});

describe("the PG identity pack", () => {
  const PG_PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  function venice(answers: string[]) {
    const drawn: { url: string; body: Record<string, unknown> }[] = [];
    setPgStudioFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      drawn.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(PG_PNG, { headers: { "content-type": "image/png" } });
    });
    let i = 0;
    setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing: answers[i++ % answers.length], age: "ADULTS" }) } }] }));
    return drawn;
  }
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const pg = (id: string, body: unknown, cookie: string) =>
    pgPost(new Request(`${BASE_URL}/api/characters/${id}/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }), params(id));
  const pgState = async (id: string, cookie: string) => (await pgGet(new Request(`${BASE_URL}/api/characters/${id}/studio`, { headers: { cookie } }), params(id))).json();
  async function pgOwner() {
    const uid = crypto.randomUUID();
    const cookie = signedInCookie(uid);
    const id = (await (await api.createCharacter(validCharacter({ name: `Pia ${uid.slice(0, 6)}` }), cookie)).json()).id as string;
    return { uid, cookie, id };
  }
  beforeEach(async () => {
    await saveAdultSettings(t.db, { venice_key: "placeholder-venice", studio: { pg: { open_to: "everyone" } } });
  });

  it("draws eight checked views of their portrait in safe mode, keeps the ones that pass, and never uses up the free first shoot", async () => {
    const me = await pgOwner();
    // No portrait yet: nothing to draw from.
    expect((await pg(me.id, { action: "identity_pack" }, me.cookie)).status).toBe(409);
    const portrait = `data:image/png;base64,${PG_PNG.toString("base64")}`;
    await t.db.query(`insert into character_assets (id, character_id, kind, source_type, url, review_status, content_rating) values ($1, $2, 'portrait', 'uploaded', $3, 'approved', 'pg')`, [crypto.randomUUID(), me.id, portrait]);
    expect((await pg(me.id, { action: "identity_pack" }, me.cookie)).status).toBe(402);
    await tokensOf(me.uid, 5);
    const drawn = venice(["CLOTHED", "CLOTHED", "NUDITY", "CLOTHED"]);
    const r = await (await pg(me.id, { action: "identity_pack" }, me.cookie)).json();
    expect(r.shoot).toMatchObject({ asked: 8, made: 6, tokens: 2, free: false });
    expect(drawn).toHaveLength(8);
    expect(drawn.every((d) => d.url.endsWith("/image/multi-edit") && d.body.safe_mode === true && (d.body.images as string[])[0] === portrait)).toBe(true);
    const s = await pgState(me.id, me.cookie);
    expect(Object.keys(s.identity_pack)).toHaveLength(6);
    expect(Object.values(s.identity_pack).every((v) => !(v as { stale: boolean }).stale)).toBe(true);
    expect(s.identity_price).toBe(2);
    // The character's first shoot is still the free one.
    expect(s.free).toBe(true);
    // A new portrait: the views drawn from the old one say so.
    await t.db.query(`update character_assets set url = $2 where character_id = $1`, [me.id, `data:image/png;base64,${Buffer.from("another").toString("base64")}`]);
    expect(Object.values((await pgState(me.id, me.cookie)).identity_pack).every((v) => (v as { stale: boolean }).stale)).toBe(true);
  });

  it("is free for an admin on the house cast, keyed to the portrait's path on every host", async () => {
    const me = await pgOwner();
    await claimAdmin(t.db, me.uid);
    venice(["CLOTHED"]);
    const r = await (await pg(HOUSE_CHARACTERS[0].id, { action: "identity_pack", views: ["front", "smiling"] }, me.cookie)).json();
    expect(r.shoot).toMatchObject({ asked: 2, made: 2, tokens: 0 });
    expect(faceKey("https://botchelor.com/cast/a.webp")).toBe(faceKey("https://www.botchelor.com/cast/a.webp"));
  });
});

describe("the faces' buttons", () => {
  it("draw the pack, the missing views or the picked ones, and say which were drawn from an earlier face", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: IdentityPackGrid } = await import("@/app/studio/IdentityPackGrid");
    const props = { name: "Mara", price: (n: number) => `${identityPrice(2, n)} tokens`, src: (id: string) => `/m/${id}`, busy: false, onDraw: () => {}, uses: "For Fix faces." };
    const empty = renderToStaticMarkup(createElement(IdentityPackGrid, { ...props, pack: {} }));
    expect(empty).toContain("Draw all 8 · 2 tokens");
    expect(empty).toContain("Not drawn yet");
    const some = renderToStaticMarkup(createElement(IdentityPackGrid, { ...props, pack: { front: { id: "f", stale: false }, smiling: { id: "s", stale: true } } }));
    expect(some).toContain("1 of 8 views");
    expect(some).toContain("earlier face");
    expect(some).toContain("Draw the 7 still to do · 2 tokens");
    const { default: FixFaces } = await import("@/app/after-dark/FixFaces");
    expect(renderToStaticMarkup(createElement(FixFaces, { id: "p", src: (id: string) => id, label: "The picture" }))).toContain("🩹 Fix faces");
    expect(renderToStaticMarkup(createElement(FixFaces, { id: "p", src: (id: string) => id, label: "The picture", nudge: true }))).toContain("Only the faces get redrawn");
    const { default: RateMedia } = await import("@/app/after-dark/[a]/[b]/RateMedia");
    const rated = renderToStaticMarkup(createElement(RateMedia, { id: "p", kind: "scene", rating: -1, tags: ["face"], extra: (r: { rating: number | null; tags: string[] }) => (r.tags.includes("face") ? "FIX-HERE" : null) }));
    expect(rated).toContain("FIX-HERE");
  });
});

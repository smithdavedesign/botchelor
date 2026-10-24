import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as mediaGet } from "@/app/api/admin/after-dark/media/[id]/route";
import { GET as sharesGet, POST as sharesPost } from "@/app/api/admin/after-dark/shares/route";
import { GET as studioGet, POST as studioPost } from "@/app/api/admin/after-dark/studio/route";
import { PUT as connectionsPut } from "@/app/api/me/connections/route";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setStudioPausesForTests } from "@/lib/adult/studio";
import { ANIMATE_MOTIONS, animatePrompt, VARIATION_HINTS, variationPrompt } from "@/lib/adult/studio-catalog";
import { DEFAULT_STUDIO_CONFIG, mergeStudioConfig } from "@/lib/adult/studio-config";
import { claimAdmin } from "@/lib/admins";
import { assignJob, saveConnection } from "@/lib/connections";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { checkAdultText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { loadChain } from "@/lib/text-chain";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// Studio v2 and v3 (lib/adult/studio.ts, lib/adult/shares.ts, docs/PRDs/studio.md): pair shoots, more like this,
// upscaling, own keys, sharing; saved setups, face strength, animate. No live calls: Venice, Replicate and Hive are stubbed.

const YOUNG = /\b(teen\w*|young\w*|girl\w*|boy\w*|school\w*|student\w*|petite|little|tiny|child\w*|kid\w*|underage|minor\w*|babysit\w*|cheerlead\w*|braces|pigtail\w*|barely|innocent|virgin)\b/i;

describe("v2's words and settings", () => {
  it("writes more-like-this prompts to the lines, an adult never under 21, the source's level", () => {
    for (const h of VARIATION_HINTS) {
      expect(checkAdultText({ words: h }).ok, h).toBe(true);
      expect(YOUNG.test(h), h).toBe(false);
    }
    const p = variationPrompt({ noun: "woman", age: 19, look: "long copper-red hair", outfit: null }, 3, { body: true }, VARIATION_HINTS[0]);
    expect(p).toMatch(/^Make one photograph of the woman from Picture 1, with the body from Picture 2, like Picture 3\./);
    expect(p).toContain("A 21-year-old adult woman");
    expect(p).toMatch(/Explicit, uncensored, photorealistic\. Everyone shown is an adult\.$/);
    expect(variationPrompt({ noun: "man", age: 30, look: "", outfit: null }, 0, { body: false }, VARIATION_HINTS[1])).toContain("like Picture 2");
  });

  it("keeps upscaling, own keys and sharing configurable", () => {
    expect(DEFAULT_STUDIO_CONFIG.upscale).toEqual({ scale: 2, usd: 0.02 });
    expect(mergeStudioConfig(DEFAULT_STUDIO_CONFIG, { upscale: { scale: 4 } }).upscale).toEqual({ scale: 4, usd: 0.02 });
    expect(() => mergeStudioConfig(DEFAULT_STUDIO_CONFIG, { upscale: { scale: 3 } })).toThrow();
    expect(mergeStudioConfig(DEFAULT_STUDIO_CONFIG, { own_keys: { replicate: false } }).own_keys).toEqual({ venice: true, replicate: false });
    expect(mergeStudioConfig(DEFAULT_STUDIO_CONFIG, { share: { pg_max_nsfw: 0.1 } }).share).toMatchObject({ photos: true, pg_max_nsfw: 0.1 });
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
const BIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const mod = (nsfw: number, child = 0.01) => ({ output: [{ classes: [{ class: "yes_child_present", value: child }, { class: "no_child_present", value: 1 - child }, { class: "general_nsfw", value: nsfw }] }] });
const answer = (a: string) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: a }) } }] });
/** Hive, stubbed: adults, and how explicit it scores each picture (`child`: its child head fires). */
function fakeHive(nsfw = 0.9, child = 0.01) {
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? answer("ADULTS") : mod(nsfw, child)));
}
/** Venice's multi-edit and upscaler, stubbed: what each was sent, and with which key. */
function fakeVenice() {
  const edits: { model: string; prompt: string; images: string[]; key: string }[] = [];
  const upscales: { image: string; scale: number; key: string }[] = [];
  // A video (the Studio's Animate): queued, then still being made until `video.ready`.
  const video = { ready: false, queued: [] as Record<string, unknown>[], released: 0 };
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const key = String(new Headers(init?.headers).get("authorization") ?? "");
    if (String(input).endsWith("/image/multi-edit")) {
      edits.push({ model: body.modelId, prompt: body.prompt, images: body.images, key });
      return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    }
    if (String(input).endsWith("/image/upscale")) {
      upscales.push({ image: body.image, scale: body.scale, key });
      return new Response(new Uint8Array(BIG), { headers: { "content-type": "image/png" } });
    }
    if (String(input).endsWith("/video/queue")) {
      video.queued.push(body);
      return Response.json({ queue_id: `q-${video.queued.length}` });
    }
    if (String(input).endsWith("/video/retrieve")) {
      if (body.delete_media_on_completion) {
        video.released++;
        return Response.json({ ok: true });
      }
      return video.ready ? new Response(new Uint8Array(BIG), { headers: { "content-type": "video/mp4" } }) : Response.json({ status: "PROCESSING" });
    }
    return new Response("?", { status: 500 });
  });
  setMediaFetchForTests(async () => Response.json({ images: [Buffer.from(PNG).toString("base64")] }));
  return { edits, upscales, video };
}

const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  studioPost(new Request(`${BASE_URL}/api/admin/after-dark/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const get = (cookie: string, q: string) => studioGet(new Request(`${BASE_URL}/api/admin/after-dark/studio?${q}`, { headers: { cookie } }));
const shares = (cookie: string, body?: unknown) =>
  body === undefined
    ? sharesGet(new Request(`${BASE_URL}/api/admin/after-dark/shares`, { headers: { cookie } }))
    : sharesPost(new Request(`${BASE_URL}/api/admin/after-dark/shares`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const picture = (cookie: string, id: string) => mediaGet(new Request(`${BASE_URL}/api/admin/after-dark/media/${id}`, { headers: { cookie } }), { params: Promise.resolve({ id }) });

/** A person with an account (and, `entitled`, After Dark open to them) and a character of theirs. */
async function person(name: string, opts: { entitled?: boolean; pronouns?: string } = {}) {
  const raw = newUserCookie();
  const id = userIdOf(raw);
  await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, $2, $3)`, [id, `g-${id}`, `${id.slice(0, 8)}@example.test`]);
  const c = (await (await api.createCharacter(validCharacter({ name, pronouns: opts.pronouns ?? "she/her", age: 29 }), raw)).json()) as { id: string };
  if (opts.entitled) await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: signedIn(id), character: c.id };
}

/** A ready date between two characters (who can share with whom). */
async function dated(a: string, b: string) {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility)
     values ($1, 'someone', $2, $3, 'the lighthouse', '{}'::jsonb, '[]'::jsonb, '', '', 'second_date', now(), '[]'::jsonb, 'ready', 'public')`,
    [crypto.randomUUID(), a, b],
  );
}

/** After Dark on, the Studio open to everyone entitled; the owner (admin or a subscriber with tokens) and their character, with a face. */
async function setup(opts: { admin?: boolean } = {}) {
  const me = await person("Mara Quill", { entitled: !opts.admin });
  if (opts.admin) await claimAdmin(t.db, me.id);
  else await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 20, 'test')`, [crypto.randomUUID(), me.id]);
  await saveAdultSettings(t.db, {
    enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", auto_scene_pictures: false,
    studio: { open_to: "entitled" },
  });
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [me.id, me.character]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [me.id, me.character, Buffer.from(PNG)]);
  return me;
}
const used = async (who: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [who])).rows[0]?.used ?? 0;

describe("a shoot together", () => {
  it("offers the pair's menu, draws both faces as Pictures 1 and 2, keeps the pictures under the pair, and prices the pair's tier", async () => {
    const me = await setup();
    const house = HOUSE_CHARACTERS[0].id;
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-h', $1, $2, 'baseline', 'p', 'image/png', $3)`, [me.id, house, Buffer.from(PNG)]);
    fakeHive();
    const { edits } = fakeVenice();
    const s = await (await get(me.cookie, `character=${me.character}`)).json();
    expect(s.state.partners.map((p: { id: string }) => p.id)).toContain(house);
    const menu = (await (await get(me.cookie, `character=${me.character}&partner=${house}`)).json()).pair_menu;
    expect(menu.partner.id).toBe(house);
    expect(menu.places.some((p: { id: string }) => p.id === "bedroom")).toBe(true);
    // Not held to how far a night has gone (they've had none): the explicit acts are on the menu.
    expect(menu.acts.find((a: { id: string }) => a.id === "face_to_face")).toMatchObject({ available: true });
    const res = await post({ action: "pair", character_id: me.character, partner: house, act: "face_to_face", outfit: "nude", framing: "medium", place: "bedroom", light: "warm" }, me.cookie);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.shoot).toMatchObject({ kind: "pair", made: 4, tokens: 1 });
    expect(await used(me.id)).toBe(1);
    expect(edits).toHaveLength(4);
    expect(edits[0].images).toHaveLength(2);
    expect(edits[0].prompt).toMatch(/^Make one photograph of the woman from Picture 1 and the /);
    expect(edits[0].prompt).toContain("The place: a softly lit bedroom with white sheets.");
    expect(edits[0].prompt).toMatch(/Light: warm low-key light/i);
    const [lo, hi] = [me.character, house].sort();
    const rows = (await t.db.query<{ character_id: string; character_b: string }>(`select character_id, character_b from adult_images where shoot_id = $1`, [out.shoot.id])).rows;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.character_id === lo && r.character_b === hi)).toBe(true);
    expect((await t.db.query<{ partner_id: string }>(`select partner_id from adult_studio_shoots where id = $1`, [out.shoot.id])).rows[0].partner_id).toBe(house);
    expect(out.state.pair_gallery).toHaveLength(4);
    // Nothing undressed somewhere public; nothing past the Studio's highest level; nothing past the pair's own limits.
    expect((await post({ action: "pair", character_id: me.character, partner: house, act: "face_to_face", outfit: "nude", framing: "medium", place: "beach" }, me.cookie)).status).toBe(422);
    await saveAdultSettings(t.db, { studio: { max_level: 0 } });
    expect((await post({ action: "pair", character_id: me.character, partner: house, act: "face_to_face", outfit: "nude", framing: "medium", place: "bedroom" }, me.cookie)).status).toBe(422);
    await saveAdultSettings(t.db, { studio: { max_level: 3 } });
    await t.db.query(
      `insert into adult_scenes (id, owner_id, character_a, character_b, lines, intensity) values ('scene-1', $1, $2, $3, '[]'::jsonb, 'flirty')`,
      [me.id, lo, hi],
    );
    expect((await post({ action: "pair", character_id: me.character, partner: house, act: "face_to_face", outfit: "nude", framing: "medium", place: "bedroom" }, me.cookie)).status).toBe(422);
    expect(await used(me.id)).toBe(1);
    // Someone not in their After Dark: not found.
    const other = await person("Ines Vale");
    expect((await post({ action: "pair", character_id: me.character, partner: other.character, act: "kiss", outfit: "tonight", framing: "close", place: "bedroom" }, me.cookie)).status).toBe(404);
  });
});

describe("more like this, and upscale", () => {
  it("draws pictures like one of theirs after the face, at that picture's level, and makes one larger on Venice's upscaler", async () => {
    const me = await setup({ admin: true });
    fakeHive();
    const { edits, upscales } = fakeVenice();
    const shot = await (await post({ action: "shoot", character_id: me.character, choices: { wardrobe: "nude" } }, me.cookie)).json();
    const src = shot.pictures[0].id;
    const more = await (await post({ action: "variations", character_id: me.character, image_id: src }, me.cookie)).json();
    expect(more.shoot).toMatchObject({ kind: "variations", made: 4 });
    const last = edits.at(-1)!;
    expect(last.images).toHaveLength(2);
    expect(last.images[1]).toContain(`/media/${src}?until=`);
    expect(last.prompt).toContain("like Picture 2");
    expect(last.prompt).toMatch(/Uncensored, photorealistic/);
    expect(new Set(edits.slice(-4).map((e) => e.prompt)).size).toBe(4);
    // Past their studio limit now: refused, nothing drawn.
    await post({ action: "limits", character_id: me.character, intensity: "flirty" }, me.cookie);
    const before = edits.length;
    expect((await post({ action: "variations", character_id: me.character, image_id: src }, me.cookie)).status).toBe(422);
    expect(edits).toHaveLength(before);
    // Upscale: the picture's own bytes, 2x, kept beside it and counted as an upscale.
    const up = await (await post({ action: "upscale", character_id: me.character, image_id: src }, me.cookie)).json();
    expect(up.shoot).toMatchObject({ kind: "upscale", made: 1, model: "upscale" });
    expect(upscales).toEqual([{ image: Buffer.from(PNG).toString("base64"), scale: 2, key: "Bearer placeholder-venice" }]);
    expect((await t.db.query<{ upscales: number }>(`select upscales from adult_usage where owner_id = $1`, [me.id])).rows[0].upscales).toBe(1);
    // Someone else's picture: not found.
    const other = await setupOther();
    expect((await post({ action: "upscale", character_id: me.character, image_id: other }, me.cookie)).status).toBe(404);
  });

  it("stops at the month's upscales", async () => {
    const me = await setup();
    fakeHive();
    fakeVenice();
    await saveAdultSettings(t.db, { caps: { upscales: 0 } });
    expect((await post({ action: "upscale", character_id: me.character, image_id: "face-1" }, me.cookie)).status).toBe(429);
  });
});

/** A picture of someone else's. */
async function setupOther(): Promise<string> {
  const o = await person("Ines Vale");
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ('theirs-1', $1, $2, 'baseline', 'p', 'image/png', $3, 'ready')`, [o.id, o.character, Buffer.from(PNG)]);
  return "theirs-1";
}

describe("their own key", () => {
  it("runs a job on their Venice key for its own price, counts it on their key's month, and refuses a model it can't run", async () => {
    const me = await setup();
    fakeHive();
    const { edits } = fakeVenice();
    // Connections: After Dark pictures is only for someone After Dark is open to.
    const stranger = await person("Rhea Stone");
    const put = (cookie: string, body: unknown) => connectionsPut(new Request(`${BASE_URL}/api/me/connections`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    await saveConnection(t.db, stranger.id, "venice", "placeholder-their-venice-0001");
    expect((await put(stranger.cookie, { provider: "venice", job: "after_dark" })).status).toBe(404);
    await saveConnection(t.db, me.id, "venice", "placeholder-their-venice-0002");
    expect((await put(me.cookie, { provider: "venice", job: "after_dark", model: "qwen-image-2-1-turbo-edit" })).status).toBe(200);
    const s = await (await get(me.cookie, `character=${me.character}`)).json();
    expect(s.state.own_key).toEqual({ provider: "venice", model: "qwen-image-2-1-turbo-edit", allowed: true, problem: null });
    const out = await (await post({ action: "shoot", character_id: me.character, choices: {}, own_key: true }, me.cookie)).json();
    expect(out.shoot).toMatchObject({ made: 4, tokens: 0 });
    expect(edits.at(-1)!.key).toBe("Bearer placeholder-their-venice-0002");
    expect(await used(me.id)).toBe(0);
    expect((await t.db.query<{ studio: number; studio_byok: number }>(`select studio, studio_byok from adult_usage where owner_id = $1`, [me.id])).rows[0]).toMatchObject({ studio: 0, studio_byok: 4 });
    const spent = (await t.db.query<{ cost_usd: number }>(`select cost_usd from user_connection_usage where user_id = $1 and job = 'after_dark'`, [me.id])).rows[0];
    expect(spent.cost_usd).toBeCloseTo(0.16, 5);
    // A Replicate model doesn't run on a Venice key; own Venice keys switched off; no key at all.
    expect((await post({ action: "shoot", character_id: me.character, choices: {}, model: "qwen/qwen-image-edit-2511", own_key: true }, me.cookie)).status).toBe(422);
    await saveAdultSettings(t.db, { studio: { own_keys: { venice: false } } });
    expect((await post({ action: "shoot", character_id: me.character, choices: {}, own_key: true }, me.cookie)).status).toBe(403);
    await assignJob(t.db, me.id, "after_dark", "venice", null);
    await t.db.query(`delete from user_connection_jobs where user_id = $1`, [me.id]);
    expect((await post({ action: "shoot", character_id: me.character, choices: {}, own_key: true }, me.cookie)).status).toBe(409);
  });
});

describe("sharing", () => {
  it("asks a person first in After Dark (told only if After Dark is open to them), shows it once they accept, and either side can take it away", async () => {
    const me = await setup({ admin: true });
    fakeHive();
    fakeVenice();
    const them = await person("Juno Park", { entitled: true });
    await dated(me.character, them.character);
    const shot = await (await post({ action: "shoot", character_id: me.character, choices: { wardrobe: "nude" } }, me.cookie)).json();
    const pic = shot.pictures[0].id;
    expect(shot.state.share_to).toEqual([{ character_id: them.character, name: "Juno Park", agent: false }]);
    const r = await (await post({ action: "share", character_id: me.character, image_id: pic, to_character: them.character, kind: "after_dark" }, me.cookie)).json();
    expect(r.share).toMatchObject({ kind: "after_dark", status: "pending" });
    expect(r.state.shares[pic]).toMatchObject([{ kind: "after_dark", status: "pending", to_name: "Juno Park" }]);
    const note = (await t.db.query<{ title: string; link: string }>(`select title, link from notifications where user_id = $1`, [them.id])).rows;
    expect(note).toEqual([{ title: "Something was shared with you", link: "/after-dark#shared" }]);
    // Waiting: no picture until they accept.
    const waiting = await (await shares(them.cookie)).json();
    expect(waiting.shares).toMatchObject([{ status: "pending", from_name: "Mara Quill", to_name: "Juno Park", image_id: null }]);
    expect((await picture(them.cookie, pic)).status).toBe(404);
    const accepted = await (await shares(them.cookie, { action: "answer", share_id: waiting.shares[0].id, accept: true })).json();
    expect(accepted.shares[0]).toMatchObject({ status: "accepted", image_id: pic });
    expect((await picture(them.cookie, pic)).status).toBe(200);
    // Never their face, never theirs to share on.
    expect((await post({ action: "share", character_id: them.character, image_id: pic, to_character: me.character, kind: "after_dark" }, them.cookie)).status).toBe(404);
    // The sharer takes it back: gone for them.
    expect((await post({ action: "unshare", character_id: me.character, share_id: r.share.id }, me.cookie)).status).toBe(200);
    expect((await picture(them.cookie, pic)).status).toBe(404);
    // Someone After Dark isn't open to: the sharer hears the same, and they aren't told.
    const closed = await person("Wren Hale");
    await dated(me.character, closed.character);
    const quiet = await (await post({ action: "share", character_id: me.character, image_id: pic, to_character: closed.character, kind: "after_dark" }, me.cookie)).json();
    expect(quiet.share).toMatchObject({ status: "pending" });
    expect((await t.db.query(`select 1 from notifications where user_id = $1`, [closed.id])).rows).toHaveLength(0);
    // Auto-accept: shown straight away.
    await shares(them.cookie, { action: "auto_accept", on: true });
    const auto = await (await post({ action: "share", character_id: me.character, image_id: shot.pictures[1].id, to_character: them.character, kind: "after_dark" }, me.cookie)).json();
    expect(auto.share.status).toBe("accepted");
    // Not someone they've dated: refused.
    const stranger = await person("Noor Ellis", { entitled: true });
    expect((await post({ action: "share", character_id: me.character, image_id: pic, to_character: stranger.character, kind: "after_dark" }, me.cookie)).status).toBe(404);
  });

  it("sends a dressed, clean picture into their texts as a photo an agent can read, and nothing else", async () => {
    const me = await setup({ admin: true });
    fakeVenice();
    // An agent's character: its owner has no account.
    const agentChar = (await (await api.createCharacter(validCharacter({ name: "Pax Orin", pronouns: "he/him", age: 33 }), newUserCookie())).json()) as { id: string };
    await dated(me.character, agentChar.id);
    // An explicit picture can't go to an agent at all, nor into texts.
    fakeHive(0.95);
    const nude = await (await post({ action: "shoot", character_id: me.character, choices: { wardrobe: "nude" } }, me.cookie)).json();
    expect((await post({ action: "share", character_id: me.character, image_id: nude.pictures[0].id, to_character: agentChar.id, kind: "after_dark" }, me.cookie)).status).toBe(422);
    expect((await post({ action: "share", character_id: me.character, image_id: nude.pictures[0].id, to_character: agentChar.id, kind: "photo" }, me.cookie)).status).toBe(422);
    // Dressed, but the check scored it too explicit: refused.
    const dressedHot = await (await post({ action: "shoot", character_id: me.character, choices: { wardrobe: "evening" } }, me.cookie)).json();
    expect(dressedHot.shoot.made).toBe(4);
    expect((await post({ action: "share", character_id: me.character, image_id: dressedHot.pictures[0].id, to_character: agentChar.id, kind: "photo" }, me.cookie)).status).toBe(422);
    // Dressed and clean: a photo in their texts, approved as a show asset, which the agent's read_texts can open.
    fakeHive(0.02);
    const clean = await (await post({ action: "shoot", character_id: me.character, choices: { wardrobe: "evening" } }, me.cookie)).json();
    const sent = await (await post({ action: "share", character_id: me.character, image_id: clean.pictures[0].id, to_character: agentChar.id, kind: "photo" }, me.cookie)).json();
    expect(sent.share).toMatchObject({ kind: "photo", status: "sent" });
    const asset = (await t.db.query<{ id: string; kind: string; review_status: string }>(`select id, kind, review_status from character_assets where kind = 'photo'`)).rows[0];
    expect(asset).toMatchObject({ kind: "photo", review_status: "approved" });
    const chain = await loadChain(t.db, me.character, agentChar.id, { userId: me.id, owner: true });
    expect(chain.find((x) => x.kind === "text" && x.photo)).toMatchObject({ text: "📷", via: "photo", photo: `/api/assets/${asset.id}` });
  });
});

describe("v3: setups, face strength and animate", () => {
  it("writes each motion to the lines, and an animation's prompt keeps the one person as they are", () => {
    for (const m of ANIMATE_MOTIONS) {
      expect(checkAdultText({ words: m.words }).ok, m.id).toBe(true);
      expect(YOUNG.test(m.words), m.id).toBe(false);
    }
    const p = animatePrompt({ noun: "woman" }, 0, ANIMATE_MOTIONS[2].words);
    expect(p).toMatch(/^The woman in the picture turns slowly to face the camera/);
    expect(p).toContain("Only this one person, exactly as in the picture");
    expect(p).toMatch(/Photorealistic\. Everyone shown is an adult\.$/);
  });

  it("saves a shoot's choices under a name (replaced by name, without a place of one character's own), runs it, and deletes it", async () => {
    const me = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    const saved = await (
      await post({ action: "save_setup", character_id: me.character, name: "  Golden  hour ", kind: "shoot", choices: { pose: "standing", light: "golden", place: "own:0" }, model: "qwen-image-2-1-turbo-edit" }, me.cookie)
    ).json();
    expect(saved.setup).toMatchObject({ name: "Golden hour", kind: "shoot", choices: { pose: "standing", light: "golden" }, model: "qwen-image-2-1-turbo-edit" });
    expect(saved.setup.choices.place).toBeUndefined();
    const again = await (await post({ action: "save_setup", character_id: me.character, name: "Golden hour", kind: "shoot", choices: { pose: "front" } }, me.cookie)).json();
    expect(again.state.setups).toHaveLength(1);
    expect(again.state.setups[0]).toMatchObject({ choices: { pose: "front" }, model: null });
    // A setup together keeps no partner and no place of their night.
    const pair = await (await post({ action: "save_setup", character_id: me.character, name: "Slow dance", kind: "pair", choices: { act: "dance", outfit: "dressed_up", framing: "wide", place: "night:0" } }, me.cookie)).json();
    expect(pair.setup.choices).toEqual({ act: "dance", outfit: "dressed_up", framing: "wide" });
    // Run: the shoot with its choices.
    const shot = await (await post({ action: "shoot", character_id: me.character, choices: again.state.setups.find((x: { name: string }) => x.name === "Golden hour").choices }, me.cookie)).json();
    expect(shot.shoot.made).toBe(4);
    expect(edits.at(-1)!.prompt).toContain("Pose:");
    expect((await post({ action: "save_setup", character_id: me.character, name: "   ", kind: "shoot", choices: {} }, me.cookie)).status).toBe(422);
    const gone = await (await post({ action: "delete_setup", character_id: me.character, setup_id: pair.setup.id }, me.cookie)).json();
    expect(gone.state.setups.map((x: { name: string }) => x.name)).toEqual(["Golden hour"]);
    expect((await post({ action: "delete_setup", character_id: me.character, setup_id: pair.setup.id }, me.cookie)).status).toBe(404);
  });

  it("holds the face loosely with the face alone: no body reference", async () => {
    const me = await setup({ admin: true });
    fakeHive();
    const { edits } = fakeVenice();
    const body = await (await post({ action: "body", character_id: me.character }, me.cookie)).json();
    await post({ action: "use_body", character_id: me.character, image_id: body.pictures[0].id }, me.cookie);
    await post({ action: "shoot", character_id: me.character, choices: {} }, me.cookie);
    expect(edits.at(-1)!.images).toHaveLength(2);
    await post({ action: "strength", character_id: me.character, strength: "loose" }, me.cookie);
    await post({ action: "shoot", character_id: me.character, choices: {} }, me.cookie);
    expect(edits.at(-1)!.images).toHaveLength(1);
    expect(edits.at(-1)!.prompt).toContain("recognisably the same person");
  });

  it("animates a picture of them alone: queued from its link, collected as the page asks, checked by Hive, kept; tokens back when it isn't", async () => {
    const me = await setup();
    fakeHive();
    const { video } = fakeVenice();
    const res = await post({ action: "animate", character_id: me.character, image_id: "face-1", motion: "turn", seconds: 10 }, me.cookie);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.shoot).toMatchObject({ kind: "animate", status: "making", tokens: 5, model: "wan-3-0-image-to-video" });
    expect(await used(me.id)).toBe(5);
    expect(video.queued).toHaveLength(1);
    expect(video.queued[0]).toMatchObject({ model: "wan-3-0-image-to-video", duration: "10s", aspect_ratio: "adaptive" });
    expect(String(video.queued[0].image_url)).toContain("/media/face-1?until=");
    expect(String(video.queued[0].prompt)).toContain("turns slowly to face the camera");
    expect(String(video.queued[0].negative_prompt)).toContain("a second person");
    expect(out.state.animating).toHaveLength(1);
    // One at a time; a motion that isn't on the menu.
    expect((await post({ action: "animate", character_id: me.character, image_id: "face-1", motion: "sway", seconds: 5 }, me.cookie)).status).toBe(409);
    expect((await post({ action: "animate", character_id: me.character, image_id: "face-1", motion: "moonwalk", seconds: 5 }, me.cookie)).status).toBe(422);
    // Still being made: the page's state says so.
    let s = await (await get(me.cookie, `character=${me.character}`)).json();
    expect(s.state.animating).toHaveLength(1);
    // Done: checked, kept as a clip in their gallery, counted, and Venice's copy released.
    video.ready = true;
    s = await (await get(me.cookie, `character=${me.character}`)).json();
    expect(s.state.animating).toHaveLength(0);
    expect(s.state.shoots[0]).toMatchObject({ kind: "animate", status: "ready", made: 1 });
    const clip = s.state.gallery.find((g: { kind: string }) => g.kind === "video");
    expect(clip).toMatchObject({ id: s.state.shoots[0].pictures[0] });
    expect((await t.db.query<{ clips: number }>(`select clips from adult_usage where owner_id = $1`, [me.id])).rows[0].clips).toBe(1);
    expect(video.released).toBe(1);
    // The next: its video refused by the check (the child head fires): discarded, logged, its tokens back.
    video.ready = false;
    expect((await post({ action: "animate", character_id: me.character, image_id: "face-1", motion: "sway", seconds: 5 }, me.cookie)).status).toBe(200);
    expect(await used(me.id)).toBe(8);
    video.ready = true;
    fakeHive(0.9, 0.97);
    s = await (await get(me.cookie, `character=${me.character}`)).json();
    expect(s.state.shoots[0]).toMatchObject({ kind: "animate", status: "failed", tokens: 0 });
    expect(s.state.shoots[0].error).toMatch(/the check discarded it/);
    expect(await used(me.id)).toBe(5);
    expect((await t.db.query<{ reason: string }>(`select reason from adult_rejections where reason like 'studio animate%'`)).rows).toHaveLength(1);
    // The month's clips: none left, nothing spent.
    await saveAdultSettings(t.db, { caps: { clips: 1 } });
    fakeHive();
    expect((await post({ action: "animate", character_id: me.character, image_id: "face-1", motion: "sway", seconds: 5 }, me.cookie)).status).toBe(429);
    expect(await used(me.id)).toBe(5);
  });
});

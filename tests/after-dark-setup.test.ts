import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as studioGet, POST as studioPost } from "@/app/api/admin/after-dark/studio/route";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setupStep } from "@/lib/adult/picture-notes";
import { missingNote, type Readiness } from "@/lib/adult/readiness";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { FREE_SETUP_FACES, setStudioPausesForTests, setupOffer, studioState } from "@/lib/adult/studio";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// "Set up for pictures" (#1207; David, 2026-11-01: each character's first setup included, later ones at today's prices),
// and the no-spend fixes: drawn body references kept on Identity after a reload, and a readiness note that names what's
// missing. No live calls: Venice and Hive are stubbed, as in after-dark-studio.test.ts.

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
/** Hive's moderation and VLM, stubbed: every picture reads as adults unless `age` says otherwise. */
function fakeHive(age = "ADULTS") {
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? answer(age) : CLEAN_MOD));
}
/** Venice, stubbed: the multi-edit (body references) and new pictures (faces), and what each was asked. */
function fakeVenice(opts: { down?: boolean } = {}) {
  const edits: string[] = [];
  const news: string[] = [];
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/image/multi-edit")) {
      edits.push(JSON.parse(String(init?.body ?? "{}")).prompt);
      return opts.down ? new Response("down", { status: 500 }) : new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    }
    return new Response("?", { status: 500 });
  });
  setMediaFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    news.push(JSON.parse(String(init?.body ?? "{}")).model);
    return opts.down ? new Response("down", { status: 500 }) : Response.json({ images: [Buffer.from(PNG).toString("base64")] });
  });
  return { edits, news };
}

const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  studioPost(new Request(`${BASE_URL}/api/admin/after-dark/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const state = async (cookie: string, id: string) => (await studioGet(new Request(`${BASE_URL}/api/admin/after-dark/studio?character=${id}`, { headers: { cookie } }))).json();
const used = async (who: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [who])).rows[0]?.used ?? 0;
const grant = (who: string, n: number) => t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), who, n]);
const freeTaken = async (who: string, id: string) => (await t.db.query<{ at: Date | null }>(`select free_setup_at as at from adult_identity where owner_id = $1 and character_id = $2`, [who, id])).rows[0]?.at ?? null;

/** After Dark on with Venice and Hive, the Studio open to subscribers; a subscriber (no tokens) with her own character, nothing drawn. */
async function setup(opts: { admin?: boolean } = {}) {
  const raw = newUserCookie();
  const owner = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: "Ines Varga", pronouns: "she/her", age: 24 }), raw)).json()) as { id: string };
  if (opts.admin) await claimAdmin(t.db, owner);
  else await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [owner]);
  await saveAdultSettings(t.db, {
    enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", auto_scene_pictures: false,
    studio: { open_to: "entitled" },
  });
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, character.id]);
  return { owner, cookie: signedIn(owner), character: character.id };
}

describe("Set up for pictures", () => {
  it("the first one charges nothing, draws faces and a body, and picks the first of each", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    const { edits, news } = fakeVenice();
    const before = (await state(cookie, character)).state;
    expect(before.ready).toMatchObject({ own: true, face: false, body: false, ready: false });
    // Included: two faces and the Studio's two body references, on us.
    expect(before.ready.setup).toEqual({ free: true, tokens: 0, pictures: FREE_SETUP_FACES + 2, baseline: null, drawing: false });

    const res = await post({ action: "setup", character_id: character }, cookie);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.setup).toEqual({ ready: true, free: true, tokens: 0 });
    expect(out.message).toMatch(/Ines is ready for pictures \(this first setup is included\)/);
    expect(news).toHaveLength(FREE_SETUP_FACES);
    expect(edits).toHaveLength(2);
    expect(edits[0]).toContain("Full body, head to toe");
    // Nothing spent, and the included setup recorded on her identity.
    expect(await used(owner)).toBe(0);
    expect(await freeTaken(owner, character)).not.toBeNull();
    // Picked: the first face kept and the first body reference.
    const faces = out.pictures.filter((p: { kind: string }) => p.kind === "baseline");
    const bodies = out.pictures.filter((p: { kind: string }) => p.kind === "scene");
    expect(faces).toHaveLength(FREE_SETUP_FACES);
    expect(bodies).toHaveLength(2);
    expect((await t.db.query<{ image_id: string }>(`select image_id from adult_face_refs where owner_id = $1 and character_id = $2`, [owner, character])).rows[0].image_id).toBe(faces[0].id);
    expect(out.state.identity).toMatchObject({ face: faces[0].id, body: bodies[0].id });
    expect(out.state.ready).toMatchObject({ face: true, body: true, ready: true });
    expect(out.state.ready.setup).toBeUndefined();
    // Both parts are the Studio's own jobs, marked as the setup's, no tokens on either.
    const shoots = (await t.db.query<{ kind: string; tokens: number; choices: Record<string, unknown> }>(`select kind, tokens, choices from adult_studio_shoots order by created_at`)).rows;
    expect(shoots.map((x) => x.kind)).toEqual(["recast", "body"]);
    expect(shoots.every((x) => x.tokens === 0 && x.choices.setup === true && x.choices.free === true)).toBe(true);
    // Counted against the month like any Studio picture.
    expect((await t.db.query<{ studio: number }>(`select studio from adult_usage where owner_id = $1`, [owner])).rows[0].studio).toBe(FREE_SETUP_FACES + 2);
    // Ready: nothing more to set up.
    expect((await post({ action: "setup", character_id: character }, cookie)).status).toBe(409);
  });

  it("a second one costs tokens as before: taking the face and body away doesn't make it free again", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    const { edits, news } = fakeVenice();
    expect((await post({ action: "setup", character_id: character }, cookie)).status).toBe(200);
    // Both taken away; her drawn faces are 👎'd, so there's none to reuse and the faces are drawn again.
    await t.db.query(`delete from adult_face_refs where owner_id = $1`, [owner]);
    expect((await post({ action: "use_body", character_id: character, image_id: null }, cookie)).status).toBe(200);
    for (const r of (await t.db.query<{ id: string }>(`select id from adult_images where kind = 'baseline' and character_id = $1`, [character])).rows) {
      await t.db.query(`insert into adult_media_thumbs (owner_id, media_id, rating) values ($1, $2, -1) on conflict (owner_id, media_id) do update set rating = -1`, [owner, r.id]);
    }
    const offer = await setupOffer(t.db, owner, character);
    // The Recast's price and the Body reference's, for the Recast's three faces and the two bodies.
    expect(offer).toEqual({ free: false, tokens: 2, pictures: 3 + 2, baseline: null, drawing: false });
    // No tokens: refused before anything is drawn.
    const drawn = [news.length, edits.length];
    const broke = await post({ action: "setup", character_id: character }, cookie);
    expect(broke.status).toBe(402);
    expect((await broke.json()).message).toMatch(/costs 2 tokens/);
    expect([news.length, edits.length]).toEqual(drawn);
    await grant(owner, 10);
    const out = await (await post({ action: "setup", character_id: character }, cookie)).json();
    expect(out.setup).toEqual({ ready: true, free: false, tokens: 2 });
    expect(await used(owner)).toBe(2);
    expect(news.length - drawn[0]).toBe(3);
    expect(edits.length - drawn[1]).toBe(2);
  });

  it("uses a face already drawn for them instead of drawing one, and charges only the body", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    const { edits, news } = fakeVenice();
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [owner, character, Buffer.from(PNG)]);
    // Her included setup is taken already (an earlier one): this one is paid.
    await t.db.query(`insert into adult_identity (owner_id, character_id, free_setup_at) values ($1, $2, now() - interval '1 hour')`, [owner, character]);
    expect(await setupOffer(t.db, owner, character)).toEqual({ free: false, tokens: 1, pictures: 2, baseline: "face-1", drawing: false });
    await grant(owner, 5);
    const out = await (await post({ action: "setup", character_id: character }, cookie)).json();
    expect(out.setup).toEqual({ ready: true, free: false, tokens: 1 });
    expect(news).toHaveLength(0);
    expect(edits).toHaveLength(2);
    expect(out.state.identity.face).toBe("face-1");
    expect(await used(owner)).toBe(1);
  });

  it("gives the included setup back when nothing came through, and spends it when the check refused them", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    fakeVenice({ down: true });
    const down = await (await post({ action: "setup", character_id: character }, cookie)).json();
    expect(down.setup).toMatchObject({ ready: false, free: true });
    expect(down.message).toMatch(/No face came through for Ines.*Your included setup is still there to try again/);
    expect(await freeTaken(owner, character)).toBeNull();
    expect((await setupOffer(t.db, owner, character))?.free).toBe(true);
    // The age check refused every face: we paid for those pictures, so the included setup is used.
    fakeHive("MINOR");
    fakeVenice();
    const refused = await (await post({ action: "setup", character_id: character }, cookie)).json();
    expect(refused.setup).toMatchObject({ ready: false, free: true });
    expect(refused.message).not.toMatch(/still there/);
    expect(await freeTaken(owner, character)).not.toBeNull();
    expect((await setupOffer(t.db, owner, character))?.free).toBe(false);
    expect(await used(owner)).toBe(0);
  });

  it("holds to the site's free setups a day and the switch; an admin pays nothing and keeps the character's included one", async () => {
    const { owner, character } = await setup();
    await saveAdultSettings(t.db, { studio: { free_setups_per_day: 0 } });
    expect((await setupOffer(t.db, owner, character))?.free).toBe(false);
    await saveAdultSettings(t.db, { studio: { free_setups_per_day: 100, free_setup: false } });
    expect((await setupOffer(t.db, owner, character))?.free).toBe(false);
    await saveAdultSettings(t.db, { studio: { free_setup: true } });
    expect((await setupOffer(t.db, owner, character))?.free).toBe(true);

    const admin = await setup({ admin: true });
    fakeHive();
    fakeVenice();
    expect(await setupOffer(t.db, admin.owner, admin.character)).toMatchObject({ free: false, tokens: 0 });
    const out = await (await post({ action: "setup", character_id: admin.character }, admin.cookie)).json();
    expect(out.setup).toEqual({ ready: true, free: false, tokens: 0 });
    expect(await freeTaken(admin.owner, admin.character)).toBeNull();
  });
});

describe("drawn body references", () => {
  it("are listed on Identity after a reload, from the page's own server-rendered state", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    fakeVenice();
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [owner, character, Buffer.from(PNG)]);
    const body = await (await post({ action: "body", character_id: character }, cookie)).json();
    expect(body.pictures).toHaveLength(2);
    const ids = body.pictures.map((p: { id: string }) => p.id).sort();
    // What the Studio page renders with (app/after-dark/studio/[id]/page.tsx), and what its GET answers.
    const rendered = await studioState(t.db, owner, character);
    if (!rendered.ok) throw new Error(rendered.message);
    expect(rendered.state.drawn.bodies.map((m) => m.id).sort()).toEqual(ids);
    expect((await state(cookie, character)).state.drawn.bodies.map((m: { id: string }) => m.id).sort()).toEqual(ids);
    // One 👎'd leaves the list; the faces drawn by a recast are listed apart.
    await t.db.query(`insert into adult_media_thumbs (owner_id, media_id, rating) values ($1, $2, -1)`, [owner, ids[0]]);
    const after = await studioState(t.db, owner, character);
    expect(after.ok && after.state.drawn.bodies.map((m) => m.id)).toEqual([ids[1]]);
    const recast = await (await post({ action: "recast", character_id: character }, cookie)).json();
    expect(recast.state.drawn.faces.map((m: { id: string }) => m.id).sort()).toEqual(recast.pictures.map((p: { id: string }) => p.id).sort());
  });
});

describe("the readiness note", () => {
  const r = (face: boolean, body: boolean): Readiness => ({ id: "ines", name: "Ines Varga", own: true, face, body, ready: face && body, studio: "/after-dark/studio/ines" });
  it("names what's missing, face, body or both, and links each to its step", () => {
    expect(missingNote([r(false, false)])).toBe("No pictures until they're set up: Ines needs a face and a body reference set in the Studio.");
    expect(missingNote([r(false, true)])).toBe("No pictures until they're set up: Ines needs a face picked in the Studio.");
    expect(missingNote([r(true, false)])).toBe("No pictures until they're set up: Ines needs a body reference set in the Studio.");
    expect(missingNote([r(true, true)])).toBeNull();
    expect(setupStep(r(false, false))).toEqual({ href: "/after-dark/studio/ines#recast", label: "Pick a face" });
    expect(setupStep(r(true, false))).toEqual({ href: "/after-dark/studio/ines#body-reference", label: "Set a body reference" });
    expect(setupStep(r(true, true))).toBeNull();
  });
});

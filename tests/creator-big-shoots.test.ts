import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as studioGet, POST as studioPost } from "@/app/api/admin/after-dark/studio/route";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { advanceShoot, BIG_BATCH, collectShoots, setStudioPausesForTests } from "@/lib/adult/studio";
import { shootPrice } from "@/lib/adult/studio-config";
import { spendBoughtTokens } from "@/lib/allowance";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Bigger shoots (the creator suite, 2026-10-26: lib/adult/studio.ts advanceShoot). No live calls: Venice and Hive are
// stubbed. Outside a request there's no after(), so a shoot's batches run before the answer: what's checked here is
// what lands, in what order, at what price, and what comes back.

describe("a bigger shoot's price", () => {
  it("is the price of four for each four, with the fifth four free; a pro model's doubles", () => {
    expect([4, 8, 12, 16, 20].map((n) => shootPrice(1, n))).toEqual([1, 2, 3, 4, 4]);
    expect(shootPrice(2, 20)).toBe(8);
    expect(shootPrice(1, 2)).toBe(1);
    expect(shootPrice(0, 20)).toBe(0);
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
/** Hive, stubbed: each picture's age answer in turn (ADULTS when the list runs out). */
function fakeHive(ages: string[] = []) {
  let i = 0;
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    if (String(input) !== HIVE_VLM) return Response.json(CLEAN_MOD);
    return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: ages[i++] ?? "ADULTS" }) } }] });
  });
}
/** Venice's multi-edit, stubbed: how many it drew, and how many at once at most. */
function fakeVenice() {
  const seen = { edits: 0, now: 0, max: 0 };
  setReelFetchForTests(async (input: RequestInfo | URL) => {
    if (!String(input).endsWith("/image/multi-edit")) return new Response("?", { status: 500 });
    seen.edits++;
    seen.now++;
    seen.max = Math.max(seen.max, seen.now);
    await new Promise((r) => setTimeout(r, 5));
    seen.now--;
    return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
  });
  return seen;
}
const post = (body: unknown, cookie: string) =>
  studioPost(new Request(`${BASE_URL}/api/admin/after-dark/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const state = async (cookie: string, id: string) => (await (await studioGet(new Request(`${BASE_URL}/api/admin/after-dark/studio?character=${id}`, { headers: { cookie } }))).json()).state;
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
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-1', $1, $2, 'baseline', 'p', 'image/png', $3)`, [owner, character.id, Buffer.from(PNG)]);
  return { owner, cookie: signedInCookie(owner), character: character.id };
}
const usedTokens = async (who: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [who])).rows[0]?.used ?? 0;
const grant = (who: string, n: number) => t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), who, n]);
const insertShoot = (id: string, owner: string, character: string, cols: string, vals: string, plan: unknown) =>
  t.db.query(
    `insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, model, provider, status, plan${cols}) values ($1, $2, $3, 'shoot', '{}', 'qwen-edit-uncensored', 'venice', 'making', $4::jsonb${vals})`,
    [id, owner, character, JSON.stringify(plan)],
  );

describe("a bigger shoot", () => {
  it("draws its pictures four at a time and keeps each as it comes, in one shoot", async () => {
    const { cookie, character } = await setup({ admin: true });
    fakeHive();
    const seen = fakeVenice();
    const out = await (await post({ action: "shoot", character_id: character, choices: {}, size: 12 }, cookie)).json();
    expect(seen.edits).toBe(12);
    expect(seen.max).toBeLessThanOrEqual(BIG_BATCH);
    const s = await state(cookie, character);
    const shot = s.shoots.find((x: { id: string }) => x.id === out.shoot.id);
    expect(shot).toMatchObject({ kind: "shoot", asked: 12, made: 12, status: "ready", background: true });
    expect(shot.pictures).toHaveLength(12);
    expect(s.shooting).toHaveLength(0);
    expect(s.shoot_sizes).toEqual([4, 8, 12, 20]);
    // A size the Studio doesn't offer: refused before anything's drawn.
    expect((await post({ action: "shoot", character_id: character, choices: {}, size: 5 }, cookie)).status).toBe(422);
    expect(seen.edits).toBe(12);
  });

  it("costs a subscriber per four, and gives back the share of the pictures that didn't come through", async () => {
    const { owner, cookie, character } = await setup();
    fakeVenice();
    await grant(owner, 20);
    fakeHive();
    expect((await (await post({ action: "shoot", character_id: character, choices: {}, size: 20 }, cookie)).json()).shoot.tokens).toBe(4);
    expect(await usedTokens(owner)).toBe(4);
    // Eight asked for two tokens; the check turns four of them away: one token back.
    fakeHive(["MINOR", "ADULTS", "MINOR", "ADULTS", "MINOR", "ADULTS", "MINOR", "ADULTS"]);
    const out = await (await post({ action: "shoot", character_id: character, choices: {}, size: 8 }, cookie)).json();
    const row = (await t.db.query<{ status: string; made: number; tokens: number }>(`select status, made, tokens from adult_studio_shoots where id = $1`, [out.shoot.id])).rows[0];
    expect(row).toEqual({ status: "partial", made: 4, tokens: 1 });
    expect(await usedTokens(owner)).toBe(5);
    // Every one turned away: all of it back.
    fakeHive(Array(8).fill("MINOR"));
    const none = await (await post({ action: "shoot", character_id: character, choices: {}, size: 8 }, cookie)).json();
    expect((await t.db.query<{ status: string; tokens: number }>(`select status, tokens from adult_studio_shoots where id = $1`, [none.shoot.id])).rows[0]).toEqual({ status: "failed", tokens: 0 });
    expect(await usedTokens(owner)).toBe(5);
  });

  it("is drawn once however many look at it at the same time (a lease on each batch)", async () => {
    const { owner, character } = await setup({ admin: true });
    fakeHive();
    const seen = fakeVenice();
    const id = crypto.randomUUID();
    await insertShoot(id, owner, character, ", tokens, asked", ", 0, 8", { action: "shoot", character_id: character, input: { choices: {}, size: 8 }, base: BASE_URL });
    await Promise.all([advanceShoot(t.db, owner, id), advanceShoot(t.db, owner, id), advanceShoot(t.db, owner, id)]);
    expect(seen.edits).toBe(8);
    const row = (await t.db.query<{ status: string; made: number; drawn: number; pictures: string[] }>(`select status, made, drawn, pictures from adult_studio_shoots where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ status: "ready", made: 8, drawn: 8 });
    expect(new Set(row.pictures).size).toBe(8);
    // Someone else's shoot: nothing happens.
    const other = userIdOf(newUserCookie());
    await t.db.query(`update adult_studio_shoots set status = 'making', drawn = 0 where id = $1`, [id]);
    await advanceShoot(t.db, other, id);
    expect(seen.edits).toBe(8);
  });

  it("is carried on by the next look when nobody's drawing it, and finished as it stands when it's been too long", async () => {
    const { owner, cookie, character } = await setup();
    fakeHive();
    const seen = fakeVenice();
    await grant(owner, 10);
    expect(await spendBoughtTokens(t.db, owner, 4)).toBe(true);
    const plan = { action: "shoot", character_id: character, input: { choices: {}, size: 20 }, base: BASE_URL };
    // Half drawn, its lease run out (the run that had it was cut off): the next look draws the rest.
    const resumed = crypto.randomUUID();
    await insertShoot(resumed, owner, character, ", tokens, asked, made, drawn, leased_until", ", 0, 8, 0, 4, now() - interval '1 minute'", plan);
    // An hour old and five of twenty in: finished as it stands, fifteen twentieths of its four tokens back (three).
    const stale = crypto.randomUUID();
    await insertShoot(stale, owner, character, ", tokens, asked, made, drawn, created_at", ", 4, 20, 5, 8, now() - interval '1 hour'", plan);
    await collectShoots(t.db, owner);
    expect(seen.edits).toBe(4);
    expect((await t.db.query<{ status: string; made: number }>(`select status, made from adult_studio_shoots where id = $1`, [resumed])).rows[0]).toEqual({ status: "partial", made: 4 });
    expect((await t.db.query<{ status: string; tokens: number }>(`select status, tokens from adult_studio_shoots where id = $1`, [stale])).rows[0]).toEqual({ status: "partial", tokens: 1 });
    expect(await usedTokens(owner)).toBe(1);
    // The page shows neither as landing any more.
    expect((await state(cookie, character)).shooting).toHaveLength(0);
  });

  it("gets no free redo (a shoot of four does), and its reveal shows a slot for every picture asked", async () => {
    const { owner, cookie, character } = await setup({ admin: true });
    fakeHive();
    fakeVenice();
    const big = await (await post({ action: "shoot", character_id: character, choices: {}, size: 8 }, cookie)).json();
    const small = await (await post({ action: "shoot", character_id: character, choices: {} }, cookie)).json();
    const pics = (await t.db.query<{ id: string }>(`select id from adult_images where shoot_id = any($1::text[])`, [[big.shoot.id, small.shoot.id]])).rows;
    for (const p of pics) await t.db.query(`insert into adult_media_thumbs (owner_id, media_id, rating) values ($1, $2, -1)`, [owner, p.id]);
    const s = await state(cookie, character);
    expect(s.shoots.find((x: { id: string }) => x.id === big.shoot.id).redo).toBe(false);
    expect(s.shoots.find((x: { id: string }) => x.id === small.shoot.id).redo).toBe(true);
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: ShootReveal } = await import("@/app/studio/ShootReveal");
    const html = renderToStaticMarkup(createElement(ShootReveal, { asked: 8, made: 3, pictures: ["a", "b", "c"], src: (id: string) => `/m/${id}`, label: "Shooting: 8 pictures", started: new Date().toISOString() }));
    expect(html.match(/studio-develop/g)).toHaveLength(3);
    expect(html.match(/studio-skeleton/g)).toHaveLength(5);
    expect(html).toContain("3 of 8 so far");
  });
});

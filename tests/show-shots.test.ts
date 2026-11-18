import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAdminShots, POST as postAdminShots } from "@/app/api/admin/show-shots/route";
import { GET as getShotRoute } from "@/app/api/shots/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { HIVE_MODERATION, HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { saveAdultSettings } from "@/lib/adult/settings";
import { ART_STYLES } from "@/lib/art-style";
import { sessionCookies } from "@/lib/http";
import { characterPortrait, HOUSE_PORTRAIT_IDS } from "@/lib/portraits";
import { checkAdultText } from "@/lib/safety";
import { drawShowShots, EXPRESSION_LOOKS, SHOT_ATTEMPTS, SHOT_NEURONS, shotFile, shotPrompt, shotsFor, shotSeed, SHOTS_RESERVE_NEURONS } from "@/lib/show-shots";
import { EXPRESSIONS, expressionFor, expressionOfWord, faceForTurn, latestFace, SHOTS, type Shot } from "@/lib/show-shots-shared";
import { api, BASE_URL, newUserCookie, setupEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

// The show kit's shots (lib/show-shots.ts, PRD styles-and-storylines phase 3): six expressions and three moments per
// contestant, drawn free on Workers AI from their own portrait, checked like every free picture, and shown by the line.
let t: Awaited<ReturnType<typeof startTestDb>>;
let PORTRAIT: Buffer;
let DRAWN: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  PORTRAIT = await sharp({ create: { width: 64, height: 80, channels: 3, background: { r: 180, g: 120, b: 100 } } }).jpeg().toBuffer();
  DRAWN = await sharp({ create: { width: 640, height: 640, channels: 3, background: { r: 90, g: 60, b: 140 } } }).png().toBuffer();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
});
afterEach(() => {
  setCheckFetchForTests(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const WORKER = "https://images.worker.test";
const SITE = "https://botchelor.test";
const NOON = new Date("2026-11-18T12:00:00Z");
const NIGHT = new Date("2026-11-18T21:00:00Z");
const workerOn = () => {
  vi.stubEnv("WORKERS_AI_URL", WORKER);
  vi.stubEnv("WORKERS_AI_KEY", "a-test-gate-key-0123456789");
};
const CLEAN = { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }, { class: "general_nsfw", value: 0.01 }] }] };
const NSFW = { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }, { class: "general_nsfw", value: 0.5 }] }] };
const ADULTS = { choices: [{ message: { content: "ADULTS" } }] };
// Hive checks the show's pictures here (pg_via "hive"), as in tests/looks.test.ts.
const keys = () => saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive", venice_key: "placeholder-venice", moderation: { pg_via: "hive" } });
function hive(mod: unknown = CLEAN) {
  const seen = { calls: 0 };
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    seen.calls++;
    return String(input) === HIVE_MODERATION ? Response.json(mod) : String(input) === HIVE_VLM ? Response.json(ADULTS) : new Response("?", { status: 500 });
  });
  return seen;
}
const drawn = () => Response.json({ image: DRAWN.toString("base64"), model: "@cf/black-forest-labs/flux-2-klein-4b", neurons: 104.2, used: 104.2, limit: 9000 });

type Call = { to: "portrait" | "draw" | "budget"; url: string; prompt?: string; size?: string; seed?: string | null; refs?: number };
/** The Worker (`draw`, and a budget with `left()` neurons left), and every other address serving the portrait. */
function fakeWorker(opts: { draw?: () => Response; left?: (draws: number) => number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${WORKER}/draw`) {
      const form = init?.body as FormData;
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer a-test-gate-key-0123456789");
      calls.push({ to: "draw", url, prompt: String(form.get("prompt")), size: `${form.get("width")}x${form.get("height")}`, seed: form.get("seed") as string | null, refs: form.has("input_image_0") ? 1 : 0 });
      return (opts.draw ?? drawn)();
    }
    if (url === `${WORKER}/budget`) {
      calls.push({ to: "budget", url });
      const left = opts.left?.(calls.filter((c) => c.to === "draw").length) ?? 8000;
      return Response.json({ day: "2026-11-18", used: 9000 - left, limit: 9000, left });
    }
    calls.push({ to: "portrait", url });
    return new Response(new Uint8Array(PORTRAIT), { headers: { "content-type": "image/jpeg" } });
  }) as typeof fetch;
  return { calls, fetchImpl, draws: () => calls.filter((c) => c.to === "draw") };
}

/** One of people's characters with an approved show portrait. */
async function withPortrait(looks: Record<string, unknown> = { gender: "woman" }) {
  const cookie = newUserCookie();
  const c = await (await api.createCharacter(validCharacter({ extras: { looks } }), cookie)).json();
  const assetId = await newPortrait(c.id);
  return { id: c.id as string, assetId, cookie };
}
async function newPortrait(characterId: string): Promise<string> {
  const assetId = `portrait-${crypto.randomUUID()}`;
  await t.db.query(
    `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating, created_at)
     values ($1, $2, 'portrait', 'generated', 'm', $3, 'approved', 'pg', now() + (select count(*) from character_assets) * interval '1 second')`,
    [assetId, characterId, `/api/assets/${assetId}`],
  );
  return assetId;
}
const rowsOf = async (characterId: string) =>
  (await t.db.query<{ shot: Shot; status: string; attempts: number; portrait_key: string; style: string }>(`select shot, status, attempts, portrait_key, style from show_shots where character_id = $1 order by shot`, [characterId])).rows;
const serve = (path: string) => getShotRoute(new Request(`${BASE_URL}/api/shots/${path}`), { params: Promise.resolve({ id: path }) });

describe("which face a line shows", () => {
  it("reads the line's one word: the even ones keep the portrait, dry is a smirk and deadpan is unimpressed", () => {
    for (const w of ["warm", "curious", "intrigued", "earnest", "content", "", null, undefined]) expect(expressionOfWord(w)).toBeNull();
    expect(expressionOfWord("amused")).toBe("laughing");
    expect(expressionOfWord("delighted")).toBe("laughing");
    expect(expressionOfWord("playful")).toBe("laughing");
    expect(expressionOfWord("dry")).toBe("smug");
    expect(expressionOfWord("wry")).toBe("smug");
    expect(expressionOfWord("teasing")).toBe("smug");
    expect(expressionOfWord("deadpan")).toBe("unimpressed");
    expect(expressionOfWord("guarded")).toBe("unimpressed");
    expect(expressionOfWord("charmed")).toBe("smitten");
    expect(expressionOfWord("Flustered")).toBe("flustered");
    expect(expressionOfWord("shy")).toBe("flustered");
    expect(expressionOfWord("stung")).toBe("heartbroken");
    // Several words, one at a time: the first that's one of the six wins.
    expect(expressionOfWord("dryly amused")).toBe("smug");
    expect(expressionOfWord("warm, teasing")).toBe("smug");
    expect(expressionOfWord("warm and quietly delighted")).toBe("laughing");
  });

  it("falls back on how interested they are, and a walk-out is never a smile", () => {
    expect(expressionFor({ emotion: "warm", interest: 0.9 })).toBe("smitten");
    expect(expressionFor({ emotion: "warm", interest: 0.1 })).toBe("unimpressed");
    expect(expressionFor({ emotion: "warm", interest: 0.5 })).toBeNull();
    expect(expressionFor({ emotion: "amused", interest: 0.1 })).toBe("laughing");
    expect(expressionFor({ emotion: null, interest: Number.NaN })).toBeNull();
    expect(expressionFor({ emotion: "amused", walked_out: true })).toBe("unimpressed");
    expect(expressionFor({ emotion: "hurt", walked_out: true })).toBe("heartbroken");
  });

  it("shows a face only once it's drawn, else the portrait; the stage shows each side's latest line", () => {
    const shots = { laughing: "/api/shots/l.webp" };
    expect(faceForTurn(shots, { emotion: "amused" })).toBe("/api/shots/l.webp");
    expect(faceForTurn(shots, { emotion: "smug" })).toBeNull();
    expect(faceForTurn(null, { emotion: "amused" })).toBeNull();
    const turns = [
      { side: "a" as const, emotion: "amused" },
      { side: "b" as const, emotion: "wry" },
      { side: "a" as const, emotion: "warm" },
    ];
    // a's latest line is warm (the portrait), not the laugh before it.
    expect(latestFace(shots, turns, "a")).toBeNull();
    expect(latestFace(shots, turns.slice(0, 2), "a")).toBe("/api/shots/l.webp");
    expect(latestFace(shots, turns, "b")).toBeNull();
    expect(latestFace({ ...shots, smug: "/api/shots/s.webp" }, turns, "b")).toBe("/api/shots/s.webp");
    expect(latestFace(shots, [], "a")).toBeNull();
  });
});

describe("the prompts", () => {
  it("keep the face from their portrait and change only what the shot is, a clothed grown adult in their own style", () => {
    for (const style of ART_STYLES) {
      for (const shot of SHOTS) {
        const p = shotPrompt(shot, style);
        expect(p).toContain("image 0");
        expect(p).toContain("the same face, skin tone, hair, age and outfit");
        expect(p).toContain("A clearly grown adult with mature features and adult proportions, fully clothed.");
        expect(p).toContain("No text, no logo, no watermark.");
        expect(checkAdultText({ prompt: p }).ok).toBe(true);
      }
    }
    for (const e of EXPRESSIONS) expect(shotPrompt(e, "realistic")).toContain(`Change only the expression to ${EXPRESSION_LOOKS[e]}.`);
    expect(shotPrompt("smug", "realistic")).toContain("the same person, ");
    expect(shotPrompt("smug", "realistic")).toContain("the same photographic look");
    expect(shotPrompt("smug", "semi_real")).toContain("the same character, ");
    expect(shotPrompt("smug", "semi_real")).toContain("the same 2.5D illustration style");
    expect(shotPrompt("smug", "anime")).toContain("the same anime illustration style");
    expect(shotPrompt("reveal", "semi_real")).toMatch(/^A full-length 2\.5D illustration of the same character as image 0: .*red velvet curtain.*head to shoes/);
    expect(shotPrompt("rose", "realistic")).toMatch(/^A waist-up photograph of the same person as image 0: .*a single red rose/);
    expect(shotPrompt("confessional", "anime")).toMatch(/^A waist-up anime illustration of the same character as image 0: .*confessional/);
  });

  it("seeds each shot from its portrait, so drawing again draws the same picture", () => {
    expect(shotSeed("p1", "smug")).toBe(shotSeed("p1", "smug"));
    expect(shotSeed("p1", "smug")).not.toBe(shotSeed("p2", "smug"));
    expect(shotSeed("p1", "smug")).not.toBe(shotSeed("p1", "rose"));
    expect(Number.isInteger(shotSeed("p1", "smug")) && shotSeed("p1", "smug") >= 0 && shotSeed("p1", "smug") < 2 ** 32).toBe(true);
  });
});

describe("drawing the shots", () => {
  it("waits without the Worker, before 20:00 UTC in the hourly batch, and without the checker", async () => {
    const { fetchImpl, calls } = fakeWorker();
    expect((await drawShowShots(t.db, { now: NIGHT, fetchImpl })).stopped).toBe("off");
    workerOn();
    expect((await drawShowShots(t.db, { now: NOON, fetchImpl })).stopped).toBe("hour");
    expect((await drawShowShots(t.db, { now: NIGHT, fetchImpl })).stopped).toBe("no_checker");
    expect(calls).toEqual([]);
  });

  it("draws an admin's ask at any hour: all nine from their portrait, checked for explicit content too, kept as small WebP", async () => {
    await keys();
    workerOn();
    const checks = hive();
    const c = await withPortrait({ gender: "woman", style: "semi_real" });
    const w = fakeWorker();
    const run = await drawShowShots(t.db, { characterId: c.id, baseUrl: SITE, now: NOON, fetchImpl: w.fetchImpl });
    expect(run).toEqual({ drawn: 9, refused: 0, failed: 0, characters: 1, stopped: "done" });

    // Their portrait once, then each shot from it: no budget calls for an admin's ask.
    expect(w.calls[0]).toEqual({ to: "portrait", url: `${SITE}/api/assets/${c.assetId}` });
    expect(w.calls.filter((x) => x.to === "budget")).toEqual([]);
    const draws = w.draws();
    expect(draws.map((d) => d.prompt)).toEqual(SHOTS.map((s) => shotPrompt(s, "semi_real")));
    expect(draws.map((d) => d.seed)).toEqual(SHOTS.map((s) => String(shotSeed(c.assetId, s))));
    expect(draws.every((d) => d.refs === 1)).toBe(true);
    expect(draws.map((d) => d.size)).toEqual([...EXPRESSIONS.map(() => "1024x1024"), "832x1248", "896x1120", "896x1120"]);
    // Workers AI has no checker of its own: Hive's explicit score and the age question, for every shot.
    expect(checks.calls).toBe(18);

    const shots = (await shotsFor(t.db, [c.id]))[c.id];
    expect(Object.keys(shots).sort()).toEqual([...SHOTS].sort());
    const id = shots.smitten!.match(/^\/api\/shots\/(.+)\.webp$/)![1];
    const file = await shotFile(t.db, id);
    expect(file?.mime).toBe("image/webp");
    expect((await sharp(file!.bytes).metadata()).width).toBe(512);

    const res = await serve(`${id}.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect((await serve("not-a-shot.webp")).status).toBe(404);

    // All nine are there: drawing again draws nothing, and doesn't even fetch the portrait.
    const again = fakeWorker();
    expect(await drawShowShots(t.db, { characterId: c.id, baseUrl: SITE, now: NOON, fetchImpl: again.fetchImpl })).toMatchObject({ drawn: 0, characters: 0 });
    expect(again.calls).toEqual([]);
  });

  it("never draws a refused shot again from the same portrait, and gives up on a failing one after three tries", async () => {
    await keys();
    workerOn();
    hive(NSFW);
    const refused = await withPortrait();
    expect(await drawShowShots(t.db, { characterId: refused.id, baseUrl: SITE, now: NOON, fetchImpl: fakeWorker().fetchImpl })).toMatchObject({ drawn: 0, refused: 9 });
    expect((await rowsOf(refused.id)).every((r) => r.status === "refused")).toBe(true);
    hive();
    const later = fakeWorker();
    expect(await drawShowShots(t.db, { characterId: refused.id, baseUrl: SITE, now: NOON, fetchImpl: later.fetchImpl })).toMatchObject({ drawn: 0, refused: 0 });
    expect(later.draws()).toEqual([]);
    expect(await shotsFor(t.db, [refused.id])).toEqual({});

    const failing = await withPortrait({ gender: "man" });
    const broken = fakeWorker({ draw: () => Response.json({ error: "model_failed", detail: "3040: Capacity temporarily exceeded" }, { status: 502 }) });
    for (let i = 1; i <= SHOT_ATTEMPTS; i++) {
      expect(await drawShowShots(t.db, { characterId: failing.id, baseUrl: SITE, now: NOON, fetchImpl: broken.fetchImpl })).toMatchObject({ failed: 9 });
      expect((await rowsOf(failing.id)).map((r) => r.attempts)).toEqual(SHOTS.map(() => i));
    }
    expect(await drawShowShots(t.db, { characterId: failing.id, baseUrl: SITE, now: NOON, fetchImpl: broken.fetchImpl })).toMatchObject({ failed: 0, characters: 0 });
    expect(broken.draws()).toHaveLength(9 * SHOT_ATTEMPTS);
  });

  it("starts with the house cast in the hourly batch, leaves the day's reserve, and keeps a shot the budget stopped for tomorrow", async () => {
    await keys();
    workerOn();
    hive();
    // The first house contestant (in the portraits' order) the database has: drawn from their portrait file.
    const seeded = new Set((await t.db.query<{ id: string }>(`select id from characters where id = any($1::text[])`, [[...HOUSE_PORTRAIT_IDS]])).rows.map((r) => r.id));
    const first = [...HOUSE_PORTRAIT_IDS].find((id) => seeded.has(id))!;

    // At the reserve, nothing is drawn.
    const spent = fakeWorker({ left: () => SHOTS_RESERVE_NEURONS + SHOT_NEURONS - 1 });
    expect(await drawShowShots(t.db, { baseUrl: SITE, now: NIGHT, fetchImpl: spent.fetchImpl })).toMatchObject({ drawn: 0, stopped: "budget" });
    expect(spent.draws()).toEqual([]);

    // Two shots' worth above it: two are drawn, then it stops.
    const two = fakeWorker({ left: (draws) => SHOTS_RESERVE_NEURONS + 2 * SHOT_NEURONS - draws * SHOT_NEURONS });
    expect(await drawShowShots(t.db, { baseUrl: SITE, now: NIGHT, fetchImpl: two.fetchImpl })).toMatchObject({ drawn: 2, characters: 1, stopped: "budget" });
    expect(two.calls[0].url).toBe(`${SITE}${characterPortrait(first)}`);
    const ready = (await t.db.query<{ character_id: string; portrait_key: string }>(`select character_id, portrait_key from show_shots where status = 'ready'`)).rows;
    expect(ready).toEqual([0, 1].map(() => ({ character_id: first, portrait_key: `static:${characterPortrait(first)}` })));

    // The Worker's own stop (429): the shot goes back as not tried, and an admin's ask stops too.
    const c = await withPortrait();
    const stop = fakeWorker({ draw: () => Response.json({ error: "budget", day: "2026-11-18", used: 9000, limit: 9000 }, { status: 429 }) });
    expect(await drawShowShots(t.db, { characterId: c.id, baseUrl: SITE, now: NIGHT, fetchImpl: stop.fetchImpl })).toMatchObject({ drawn: 0, failed: 0, stopped: "budget" });
    expect(stop.draws()).toHaveLength(1);
    expect((await rowsOf(c.id)).map((r) => [r.status, r.attempts])).toEqual([["failed", 0]]);
    // The next day it's drawn with the rest.
    expect(await drawShowShots(t.db, { characterId: c.id, baseUrl: SITE, now: NIGHT, fetchImpl: fakeWorker().fetchImpl })).toMatchObject({ drawn: 9, stopped: "done" });
  });

  it("shows no old faces after a new portrait or style, and draws the new ones", async () => {
    await keys();
    workerOn();
    hive();
    const c = await withPortrait({ gender: "woman", style: "semi_real" });
    await drawShowShots(t.db, { characterId: c.id, baseUrl: SITE, now: NOON, fetchImpl: fakeWorker().fetchImpl });
    const first = (await shotsFor(t.db, [c.id]))[c.id];
    expect(Object.keys(first)).toHaveLength(9);

    await t.db.query(`update characters set extras = jsonb_set(extras, '{looks,style}', '"anime"') where id = $1`, [c.id]);
    expect(await shotsFor(t.db, [c.id])).toEqual({});
    const anime = fakeWorker();
    expect(await drawShowShots(t.db, { characterId: c.id, baseUrl: SITE, now: NOON, fetchImpl: anime.fetchImpl })).toMatchObject({ drawn: 9 });
    expect(anime.draws()[0].prompt).toBe(shotPrompt(SHOTS[0], "anime"));
    expect((await rowsOf(c.id)).every((r) => r.style === "anime")).toBe(true);

    const newer = await newPortrait(c.id);
    expect(await shotsFor(t.db, [c.id])).toEqual({});
    const redrawn = fakeWorker();
    expect(await drawShowShots(t.db, { characterId: c.id, baseUrl: SITE, now: NOON, fetchImpl: redrawn.fetchImpl })).toMatchObject({ drawn: 9 });
    expect(redrawn.calls[0].url).toBe(`${SITE}/api/assets/${newer}`);
    expect(redrawn.draws()[0].seed).toBe(String(shotSeed(newer, SHOTS[0])));
    expect((await rowsOf(c.id)).every((r) => r.portrait_key === newer)).toBe(true);
    const last = (await shotsFor(t.db, [c.id]))[c.id];
    expect(Object.keys(last)).toHaveLength(9);
    expect(last.smitten).not.toBe(first.smitten);
  });

  it("rides along with an episode: each side's faces come in the episode's own query", async () => {
    await keys();
    workerOn();
    hive();
    const { creator, character, episode } = await setupEpisode();
    await newPortrait(character.id);
    await drawShowShots(t.db, { characterId: character.id, baseUrl: SITE, now: NOON, fetchImpl: fakeWorker().fetchImpl });
    const view = await (await api.getEpisode(episode.id, creator)).json();
    const mine = view.characters.find((x: { id: string }) => x.id === character.id);
    const theirs = view.characters.find((x: { id: string }) => x.id !== character.id);
    expect(Object.keys(mine.shots).sort()).toEqual([...SHOTS].sort());
    expect(mine.shots.laughing).toMatch(/^\/api\/shots\/.+\.webp$/);
    expect(theirs.shots).toBeUndefined();
  });
});

describe("the admin route", () => {
  const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
  const post = (body: unknown, cookie?: string) =>
    postAdminShots(new Request(`${BASE_URL}/api/admin/show-shots`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
  const list = (character: string, cookie?: string) => getAdminShots(new Request(`${BASE_URL}/api/admin/show-shots?character=${encodeURIComponent(character)}`, { headers: cookie ? { cookie } : {} }));

  it("is admins' only, says when there's no such character, and draws one character's kit in the background", async () => {
    await keys();
    workerOn();
    hive();
    const c = await withPortrait();
    const someone = signedIn(userIdOf(newUserCookie()));
    expect((await post({ character_id: c.id }, someone)).status).toBe(404);
    expect((await list(c.id, someone)).status).toBe(404);

    const adminId = userIdOf(newUserCookie());
    await claimAdmin(t.db, adminId);
    const admin = signedIn(adminId);
    const missing = await post({ character_id: "nobody" }, admin);
    expect(missing.status).toBe(404);
    expect((await missing.json()).message).toBe("There's no such character.");

    // The route draws with the real fetch: the Worker and the portrait are faked under it.
    const w = fakeWorker();
    vi.stubGlobal("fetch", w.fetchImpl);
    expect((await post({ character_id: c.id }, admin)).status).toBe(202);
    await vi.waitFor(async () => expect((await rowsOf(c.id)).filter((r) => r.status === "ready")).toHaveLength(9), { timeout: 15_000, interval: 50 });
    expect(w.calls[0].url).toBe(`${BASE_URL}/api/assets/${c.assetId}`);
    const seen = await (await list(c.id, admin)).json();
    expect(Object.keys(seen.shots).sort()).toEqual([...SHOTS].sort());
    expect(seen.rows).toHaveLength(9);

    // One shot drifted from their face: redo throws away only that one, and the other eight stay as they were.
    const ids = async () => Object.fromEntries((await t.db.query<{ shot: string; id: string }>(`select shot, id from show_shots where character_id = $1`, [c.id])).rows.map((r) => [r.shot, r.id]));
    const before = await ids();
    expect((await post({ character_id: c.id, redo: true, shot: "selfie" }, admin)).status).toBe(422);
    expect((await post({ character_id: c.id, redo: true, shot: "rose" }, admin)).status).toBe(202);
    await vi.waitFor(async () => expect((await ids()).rose).toBeDefined(), { timeout: 15_000, interval: 50 });
    await vi.waitFor(async () => expect((await rowsOf(c.id)).filter((r) => r.status === "ready")).toHaveLength(9), { timeout: 15_000, interval: 50 });
    const after = await ids();
    expect(after.rose).not.toBe(before.rose);
    for (const shot of SHOTS.filter((s) => s !== "rose")) expect(after[shot]).toBe(before[shot]);
  });
});

import { ART_STYLES, artStyleOf } from "@/lib/art-style";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postLooksPortrait } from "@/app/api/characters/[id]/looks-portrait/route";
import { GET as getTileRoute } from "@/app/api/looks/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { HIVE_MODERATION, HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { VENICE_IMAGE } from "@/lib/adult/media";
import { saveAdultSettings } from "@/lib/adult/settings";
import { publicExtras, normaliseExtras } from "@/lib/extras";
import { sessionCookies } from "@/lib/http";
import {
  BASELINES,
  detailsFor,
  IMAGE_MIN_AGE,
  LOOK_DETAILS,
  LOOK_STEPS,
  looksAppearance,
  LooksInput,
  looksPictureWords,
  looksPortraitPrompt,
  nearestBaseline,
  normaliseLooks,
  optionsFor,
  stepsFor,
  tileId,
  tileSpecs,
  GENDERS,
} from "@/lib/looks";
import { drawMissingTiles, drawTile, LOOKS_PG_MODEL, PORTRAITS_PER_CHARACTER, setLooksFetchForTests, setLooksPauseForTests, WORKERS_AI_MODEL } from "@/lib/looks-draw";
import { checkAdultText } from "@/lib/safety";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// The looks builder (lib/looks.ts, lib/looks-draw.ts): picture tiles drawn once and screened, the picks stored in
// extras.looks with After Dark's kept private and only for those who can open it, and a portrait from the picks.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  setLooksPauseForTests(0);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
});
afterEach(() => {
  setLooksFetchForTests(null);
  setCheckFetchForTests(null);
  vi.unstubAllEnvs();
});

const JPEG = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
const CLEAN = { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }, { class: "general_nsfw", value: 0.01 }] }] };
const ADULTS = { choices: [{ message: { content: "ADULTS" } }] };
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
// Hive checks the show's pictures here (pg_via "hive"): with Venice's key saved, "auto" would send them to its check.
const keys = () => saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive", venice_key: "placeholder-venice", moderation: { pg_via: "hive" } });

function fakeProviders() {
  const calls: { model: string; prompt: string }[] = [];
  setLooksFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `https://fal.run/${LOOKS_PG_MODEL}`) {
      calls.push({ model: "fal", prompt: JSON.parse(String(init?.body)).prompt });
      return Response.json({ images: [{ url: "https://cdn.fal.test/tile.jpg" }], has_nsfw_concepts: [false] });
    }
    if (url === VENICE_IMAGE) {
      calls.push({ model: "venice", prompt: JSON.parse(String(init?.body)).prompt });
      return Response.json({ images: [Buffer.from(JPEG).toString("base64")] });
    }
    return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
  });
  return calls;
}
const hive = (vlm: unknown = ADULTS, mod: unknown = CLEAN) =>
  setCheckFetchForTests(async (input: RequestInfo | URL) => (String(input) === HIVE_MODERATION ? Response.json(mod) : String(input) === HIVE_VLM ? Response.json(vlm) : new Response("?", { status: 500 })));
const serve = (id: string, cookie?: string) => getTileRoute(new Request(`${BASE_URL}/api/looks/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

describe("the catalog", () => {
  const specs = tileSpecs();

  it("has one tile per option of every picture step, per gender, on both tabs, and unique ids", () => {
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
    for (const g of GENDERS) {
      for (const step of stepsFor(g, true)) {
        if (step.id === "gender" || step.id === "age") continue;
        for (const o of optionsFor(step, g, false)) if (!step.afterDark) expect(specs.some((s) => s.id === tileId(g, step.id, o.id, false))).toBe(true);
        for (const o of optionsFor(step, g, true)) expect(specs.some((s) => s.id === tileId(g, step.id, o.id, true))).toBe(true);
      }
    }
    expect(specs.filter((s) => s.step === "baseline")).toHaveLength(BASELINES.length);
  });

  it("writes every prompt out in full: an adult, a single person, and the show's tiles never nude", () => {
    for (const s of specs) {
      const age = Number(s.prompt.match(/a (\d+)-year-old/)?.[1]);
      expect(age).toBeGreaterThanOrEqual(IMAGE_MIN_AGE);
      expect(s.prompt).toMatch(/a single person/);
      expect(checkAdultText({ prompt: s.prompt }).ok).toBe(true);
      if (s.variant === "pg") expect(s.prompt).toMatch(/no nudity/);
      else expect(s.prompt).toMatch(/Everyone shown is an adult\.$/);
      expect(s.prompt).not.toMatch(/\{(who|color)\}|undefined/);
    }
  });

  it("finds the nearest stock baseline for a look", () => {
    expect(nearestBaseline({ gender: "woman", ethnicity: "asian", body: "plus" })).toBe("nsfw-woman-baseline-asian-curvy");
    expect(nearestBaseline({ gender: "man", body: "muscular" })).toBe("nsfw-man-baseline-caucasian-athletic");
    expect(specs.some((s) => s.id === nearestBaseline({ gender: "woman", ethnicity: "black", body: "athletic" }))).toBe(true);
    expect(nearestBaseline({})).toBeNull();
  });

  it("turns the picks into an appearance line the sheet can hold, and drops picks that don't fit", () => {
    const line = looksAppearance({ gender: "woman", ethnicity: "latina", hair_style: "curly", hair_color: "red", eyes: "green", body: "curvy" });
    expect(line).toBe("Latina woman, long voluminous curly copper-red hair, vivid green eyes, a curvy hourglass figure with full hips");
    // The ethnicity names who it is, so it never reads as a hair colour beside the hair words (2026-11-22 audit).
    expect(looksAppearance({ gender: "woman", ethnicity: "black", hair_style: "straight", hair_color: "red" })).toBe("Black woman, long straight copper-red hair falling past the shoulders");
    expect(looksAppearance({ gender: "man", ethnicity: "black" })).toBe("Black man");
    expect(line.length).toBeLessThanOrEqual(140);
    expect(normaliseLooks({ gender: "woman", facial_hair: "full_beard", hair_style: "buzz", eyes: "blue" })).toEqual({ gender: "woman", eyes: "blue" });
    expect(normaliseLooks({ gender: "man", after_dark: { butt: "large", outfit: "towel" } })).toEqual({ gender: "man", after_dark: { outfit: "towel" } });
    expect(LOOK_STEPS.find((s) => s.id === "butt")?.afterDark).toBe(true);
  });

  it("keeps every art style, not only the builder's three tiles (2026-11-19: oil, 3D, comic and ink drew as photographs)", () => {
    for (const style of ART_STYLES) expect(normaliseLooks({ gender: "woman", style })).toEqual({ gender: "woman", style });
    expect(artStyleOf({ extras: { looks: normaliseLooks({ gender: "man", style: "render_3d" }) } })).toBe("render_3d");
  });

  it("takes the finer details as fixed choices, drops the ones that don't fit, and keeps grooming with After Dark's picks", () => {
    expect(detailsFor("woman", false).map((d) => d.id)).toEqual(["skin_tone", "marks", "makeup", "glasses", "piercings", "tattoos"]);
    expect(detailsFor("man", true).map((d) => d.id)).toEqual(["skin_tone", "marks", "makeup", "glasses", "piercings", "tattoos", "body_hair", "grooming"]);
    expect(LooksInput.safeParse({ gender: "woman", tattoos: "sleeve", after_dark: { grooming: "trimmed" } }).success).toBe(true);
    // Nothing typed: an option that isn't on the list is refused.
    expect(LooksInput.safeParse({ gender: "woman", tattoos: "a dragon on her back" }).success).toBe(false);
    expect(LooksInput.safeParse({ gender: "woman", after_dark: { grooming: "anything" } }).success).toBe(false);
    expect(normaliseLooks({ gender: "woman", body_hair: "hairy", glasses: "wire" })).toEqual({ gender: "woman", glasses: "wire" });
    expect(normaliseLooks({ gender: "man", body_hair: "hairy", after_dark: { grooming: "natural" } })).toEqual({ gender: "man", body_hair: "hairy", after_dark: { grooming: "natural" } });
    const e = normaliseExtras({ looks: { gender: "woman", marks: "freckles", after_dark: { grooming: "shaved" } } });
    expect(publicExtras(e).looks).toEqual({ gender: "woman", marks: "freckles" });
    // Every detail's words are fixed phrases with no "{" to fill.
    for (const d of LOOK_DETAILS) for (const o of d.options) expect(o.prompt).not.toMatch(/[{}]/);
  });

  it("puts the details in the appearance line while it fits, in the portrait, and in After Dark's pictures, never in a tile", () => {
    const l = { gender: "woman" as const, ethnicity: "latina", skin_tone: "lighter", eyes: "green", marks: "freckles", glasses: "thick", tattoos: "small", after_dark: { grooming: "trimmed" } };
    expect(looksAppearance(l)).toBe("Latina woman, a lighter skin tone, vivid green eyes, a light dusting of freckles across the nose and cheeks, thick black-framed glasses");
    const portrait = looksPortraitPrompt(l, 30)!;
    expect(portrait).toContain("Latin American woman with warm tan skin and Latin features, a lighter skin tone");
    expect(portrait).toContain("one small fine-line tattoo on the inner wrist");
    expect(portrait).not.toMatch(/pubic/);
    expect(looksPictureWords(l, true)).toMatchObject({ undressed: "neatly trimmed pubic hair" });
    expect(looksPictureWords(l, true).body).toContain("thick black-framed glasses");
    expect(looksPictureWords(l, false).undressed).toBeNull();
    expect(looksPictureWords({ gender: "man", body_hair: "light" }, false).body).toBe("a lightly hairy chest");
    for (const spec of tileSpecs()) expect(spec.prompt).not.toMatch(/freckles|glasses|tattoo|piercing|makeup|pubic|skin tone/);
  });

  it("keeps After Dark's picks off every public view", () => {
    const e = normaliseExtras({ looks: { gender: "woman", eyes: "green", after_dark: { butt: "large" } } });
    expect(e.looks?.after_dark).toEqual({ butt: "large" });
    expect(publicExtras(e).looks).toEqual({ gender: "woman", eyes: "green" });
  });
});

describe("drawing the tiles", () => {
  it("draws a show tile on fal and an After Dark tile on Venice, each screened, once", async () => {
    await keys();
    const calls = fakeProviders();
    hive();
    const drawn = await drawMissingTiles(t.db, { only: ["pg-woman-eyes-green", "nsfw-woman-body-curvy"] });
    expect(drawn.map((d) => d.status)).toEqual(["ready", "ready"]);
    expect(calls.map((c) => c.model).sort()).toEqual(["fal", "venice"]);
    expect(await drawMissingTiles(t.db, { only: ["pg-woman-eyes-green"] })).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("keeps nothing Hive refuses, and doesn't pay for it again", async () => {
    await keys();
    const calls = fakeProviders();
    hive({ choices: [{ message: { content: "UNSURE" } }] });
    const spec = tileSpecs().find((s) => s.id === "pg-man-style-anime")!;
    expect(await drawTile(t.db, spec)).toBe("refused");
    expect((await serve(spec.id)).status).toBe(404);
    expect(await drawTile(t.db, spec)).toBe("exists");
    expect(calls).toHaveLength(1);
  });

  it("keeps a picture Hive was too busy to screen, unshown, and screens it again without drawing it twice", async () => {
    await keys();
    const calls = fakeProviders();
    setCheckFetchForTests(async () => new Response("slow down", { status: 429 }));
    const spec = tileSpecs().find((s) => s.id === "pg-woman-hair_color-red")!;
    expect(await drawTile(t.db, spec)).toBe("failed");
    expect((await serve(spec.id)).status).toBe(404);
    await t.db.query(`update look_tiles set updated_at = now() - interval '1 hour' where id = $1`, [spec.id]);
    // One check that couldn't run is a blip: the next batch screens it again, without drawing it again. Hive down again
    // is the second in a row, which opens its breaker (lib/adult/hive-limit.ts).
    let sent = 0;
    setCheckFetchForTests(async () => {
      sent++;
      return new Response("?", { status: 500 });
    });
    expect(await drawMissingTiles(t.db, { only: [spec.id] })).toEqual([{ id: spec.id, status: "failed" }]);
    expect(sent).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    // Paused now: a batch draws and sends nothing until that's over.
    sent = 0;
    await t.db.query(`update look_tiles set updated_at = now() - interval '1 hour' where id = $1`, [spec.id]);
    expect(await drawMissingTiles(t.db, { only: [spec.id] })).toEqual([]);
    expect(sent).toBe(0);
    // The pause over, the next batch picks it up and only screens it.
    await t.db.query(`update adult_media_cooldowns set until = now() - interval '1 minute' where provider = 'hive'`);
    hive();
    expect(await drawMissingTiles(t.db, { only: [spec.id] })).toEqual([{ id: spec.id, status: "ready" }]);
    expect(calls).toHaveLength(1);
    expect((await serve(spec.id)).status).toBe(200);
    // Hive answered, so the pause is gone.
    expect((await t.db.query(`select 1 from adult_media_cooldowns`)).rows).toHaveLength(0);
  });

  it("stops a batch when the screen rate-limits, instead of paying for pictures it can't check", async () => {
    await keys();
    const calls = fakeProviders();
    setCheckFetchForTests(async () => new Response("slow down", { status: 429 }));
    const drawn = await drawMissingTiles(t.db, { only: ["pg-woman-eyes-blue", "pg-woman-eyes-grey", "pg-woman-eyes-hazel"] });
    expect(drawn).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("retries tiles stored as refused only because the check couldn't run", async () => {
    await keys();
    fakeProviders();
    hive();
    await t.db.query(`insert into look_tiles (id, variant, status, prompt, reason) values ('pg-man-eyes-blue', 'pg', 'refused', 'p', 'the check couldn''t run (Hive answered 429)'), ('pg-man-eyes-grey', 'pg', 'refused', 'p', 'age check: MINOR')`);
    expect(await drawMissingTiles(t.db, { only: ["pg-man-eyes-blue", "pg-man-eyes-grey"] })).toEqual([{ id: "pg-man-eyes-blue", status: "ready" }]);
  });

  it("asks Hive once per show picture (fal's checker covers explicit), and refuses what fal flags without asking at all", async () => {
    await keys();
    let hiveCalls = 0;
    setCheckFetchForTests(async (input: RequestInfo | URL) => {
      hiveCalls++;
      return String(input) === HIVE_MODERATION ? Response.json(CLEAN) : Response.json(ADULTS);
    });
    fakeProviders();
    expect(await drawTile(t.db, tileSpecs().find((s) => s.id === "pg-woman-eyes-brown")!)).toBe("ready");
    expect(hiveCalls).toBe(2); // moderation + the age check, once each
    setLooksFetchForTests(async (input: RequestInfo | URL) =>
      String(input).startsWith("https://fal.run/") ? Response.json({ images: [{ url: "https://cdn.fal.test/x.jpg" }], has_nsfw_concepts: [true] }) : new Response(JPEG));
    expect(await drawTile(t.db, tileSpecs().find((s) => s.id === "pg-woman-outfit-swim")!)).toBe("refused");
    expect(hiveCalls).toBe(2);
  });

  it("draws nothing without keys", async () => {
    const calls = fakeProviders();
    expect(await drawTile(t.db, tileSpecs()[0])).toBe("failed");
    expect(calls).toEqual([]);
  });
});

describe("serving the tiles", () => {
  it("serves the show's to anyone, and After Dark's only to someone who can open it", async () => {
    await keys();
    fakeProviders();
    hive();
    await drawMissingTiles(t.db, { only: ["pg-woman-body-curvy", "nsfw-woman-body-curvy"] });
    const pg = await serve("pg-woman-body-curvy");
    expect(pg.status).toBe(200);
    expect(pg.headers.get("cache-control")).toMatch(/public/);
    expect((await serve("nsfw-woman-body-curvy")).status).toBe(404);
    expect((await serve("nsfw-woman-body-curvy", signedIn(userIdOf(newUserCookie())))).status).toBe(404);
    const admin = userIdOf(newUserCookie());
    await claimAdmin(t.db, admin);
    const ad = await serve("nsfw-woman-body-curvy", signedIn(admin));
    expect(ad.status).toBe(200);
    expect(ad.headers.get("cache-control")).toMatch(/private/);
    expect((await serve("../etc")).status).toBe(404);
  });
});

describe("saving the picks", () => {
  it("keeps After Dark's picks only for an account that can open it", async () => {
    const looks = { gender: "woman", eyes: "green", after_dark: { butt: "large", outfit: "lingerie" } };
    const anon = await api.createCharacter(validCharacter({ extras: { looks } }), newUserCookie());
    expect(anon.status).toBe(201);
    expect((await anon.json()).extras.looks).toEqual({ gender: "woman", eyes: "green" });
    const admin = userIdOf(newUserCookie());
    await claimAdmin(t.db, admin);
    const mine = await api.createCharacter(validCharacter({ extras: { looks } }), signedIn(admin));
    expect((await mine.json()).extras.looks.after_dark).toEqual({ butt: "large", outfit: "lingerie" });
  });

  it("refuses a pick that isn't an option", async () => {
    const res = await api.createCharacter(validCharacter({ extras: { looks: { gender: "woman", eyes: "violet" } } }), newUserCookie());
    expect(res.status).toBe(422);
  });
});

describe("the portrait from the picks", () => {
  const draw = (id: string, cookie: string) => postLooksPortrait(new Request(`${BASE_URL}/api/characters/${id}/looks-portrait`, { method: "POST", headers: { cookie } }), { params: Promise.resolve({ id }) });

  it("draws the owner's character from its picks, screened, a few times at most", async () => {
    await keys();
    const calls = fakeProviders();
    hive();
    const cookie = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ extras: { looks: { gender: "man", hair_color: "red", facial_hair: "full_beard" } } }), cookie)).json()).id;
    expect((await draw(id, newUserCookie())).status).toBe(404);
    const res = await draw(id, cookie);
    expect(res.status).toBe(201);
    expect((await res.json()).portrait_path).toMatch(/^\/api\/assets\//);
    expect(calls[0].prompt).toMatch(/copper-red/);
    expect(calls[0].prompt).toMatch(/a full thick beard/);
    for (let i = 1; i < PORTRAITS_PER_CHARACTER; i++) expect((await draw(id, cookie)).status).toBe(201);
    expect((await draw(id, cookie)).status).toBe(429);
  });

  it("needs looks picked, and stops at the day's cap", async () => {
    await keys();
    fakeProviders();
    hive();
    const cookie = newUserCookie();
    const bare = (await (await api.createCharacter(validCharacter(), cookie)).json()).id;
    expect((await draw(bare, cookie)).status).toBe(400);
    vi.stubEnv("LOOKS_PORTRAITS_PER_DAY", "0");
    const id = (await (await api.createCharacter(validCharacter({ extras: { looks: { gender: "woman" } } }), cookie)).json()).id;
    expect((await draw(id, cookie)).status).toBe(429);
  });
});

// PRD styles-and-storylines phase 2: the show's pictures are drawn free on Workers AI (the botchelor-images Worker,
// lib/workers-ai.ts) while its daily budget lasts, then on fal as before. Workers AI has no safety checker of its own,
// so its pictures' check also asks whether they're explicit.
describe("free show pictures on Workers AI", () => {
  const WORKER = "https://images.worker.test";
  const NSFW = { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }, { class: "general_nsfw", value: 0.5 }] }] };
  const workerOn = () => {
    vi.stubEnv("WORKERS_AI_URL", WORKER);
    vi.stubEnv("WORKERS_AI_KEY", "a-test-gate-key-0123456789");
  };
  /** The Worker answers with `worker()`; fal and its file as fakeProviders does. */
  function fakeWorker(worker: () => Response) {
    const calls: { to: "worker" | "fal"; prompt: string; size?: string; seed?: string | null }[] = [];
    setLooksFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${WORKER}/draw`) {
        const form = init?.body as FormData;
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer a-test-gate-key-0123456789");
        calls.push({ to: "worker", prompt: String(form.get("prompt")), size: `${form.get("width")}x${form.get("height")}`, seed: form.get("seed") as string | null });
        return worker();
      }
      if (url === `https://fal.run/${LOOKS_PG_MODEL}`) {
        calls.push({ to: "fal", prompt: JSON.parse(String(init?.body)).prompt });
        return Response.json({ images: [{ url: "https://cdn.fal.test/tile.jpg" }], has_nsfw_concepts: [false] });
      }
      return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    });
    return calls;
  }
  const drawn = () => Response.json({ image: Buffer.from(JPEG).toString("base64"), model: "@cf/black-forest-labs/flux-2-klein-4b", neurons: 104.2, used: 104.2, limit: 9000 });
  const tile = (id: string) => tileSpecs().find((s) => s.id === id)!;
  // Drawn tiles outlive the reset (they're drawn once): each test here starts from none.
  beforeEach(async () => {
    await t.db.query(`delete from look_tiles`);
  });
  const modelOf = async (id: string) => (await t.db.query<{ model: string; status: string }>(`select model, status from look_tiles where id = $1`, [id])).rows[0];

  it("has a 2.5D tile in the style step, drawn in the house look and said to be a grown adult", () => {
    for (const g of GENDERS) {
      const spec = tile(`pg-${g}-style-semi_real`);
      expect(spec.prompt).toMatch(/^Semi-realistic painterly 2\.5D digital illustration of a \d+-year-old /);
      expect(spec.prompt).toContain("a clearly grown adult with mature adult features and proportions");
      expect(spec.prompt).not.toMatch(/photograph|photoreal/i);
      expect(checkAdultText({ prompt: spec.prompt }).ok).toBe(true);
    }
    // The other steps' tiles stay photographs.
    expect(tile("pg-woman-eyes-brown").prompt).toMatch(/^Photorealistic studio photograph of /);
    expect(looksAppearance({ gender: "woman", style: "semi_real" })).toBe("painterly 2.5D-style");
    expect(looksPortraitPrompt({ gender: "man", style: "semi_real" }, 34)).toMatch(/^Semi-realistic painterly 2\.5D digital illustration of a 34-year-old /);
  });

  it("draws a tile free, asks the check about explicit content too, and records Workers AI as what drew it", async () => {
    await keys();
    workerOn();
    const calls = fakeWorker(drawn);
    let hiveCalls = 0;
    setCheckFetchForTests(async (input: RequestInfo | URL) => {
      hiveCalls++;
      return String(input) === HIVE_MODERATION ? Response.json(CLEAN) : Response.json(ADULTS);
    });
    const spec = tile("pg-woman-style-semi_real");
    expect(await drawTile(t.db, spec)).toBe("ready");
    expect(calls).toEqual([{ to: "worker", prompt: spec.prompt, size: "512x640", seed: String(spec.seed) }]);
    expect(hiveCalls).toBe(2);
    expect(await modelOf(spec.id)).toEqual({ model: WORKERS_AI_MODEL, status: "ready" });
    expect((await serve(spec.id)).status).toBe(200);
  });

  it("refuses a free picture Hive scores as explicit, which a fal picture (its own checker on) would pass", async () => {
    await keys();
    workerOn();
    const calls = fakeWorker(drawn);
    hive(ADULTS, NSFW);
    const spec = tile("pg-man-style-semi_real");
    expect(await drawTile(t.db, spec)).toBe("refused");
    expect((await t.db.query<{ reason: string }>(`select reason from look_tiles where id = $1`, [spec.id])).rows[0].reason).toBe("moderation: general_nsfw 0.50");
    expect(calls.map((c) => c.to)).toEqual(["worker"]);
    // The same score on fal's picture: fal's own checker covers explicit content there, as before.
    vi.stubEnv("WORKERS_AI_URL", "");
    fakeProviders();
    expect(await drawTile(t.db, tile("pg-man-eyes-brown"))).toBe("ready");
  });

  it("falls back to fal once the day's free budget is spent, or the Worker fails", async () => {
    await keys();
    workerOn();
    hive();
    let answer = () => Response.json({ error: "budget", day: "2026-11-17", used: 8960, limit: 9000, neurons: 104.2 }, { status: 429 });
    const calls = fakeWorker(() => answer());
    const spent = tile("pg-woman-style-semi_real");
    expect(await drawTile(t.db, spent)).toBe("ready");
    expect(calls.map((c) => c.to)).toEqual(["worker", "fal"]);
    expect((await modelOf(spent.id)).model).toBe(LOOKS_PG_MODEL);
    answer = () => Response.json({ error: "model_failed", detail: "3040: Capacity temporarily exceeded" }, { status: 502 });
    expect(await drawTile(t.db, tile("pg-man-style-semi_real"))).toBe("ready");
    expect(calls.map((c) => c.to)).toEqual(["worker", "fal", "worker", "fal"]);
  });

  it("screens a kept free picture again from its bytes, explicit question and all, without drawing it twice", async () => {
    await keys();
    workerOn();
    const calls = fakeWorker(drawn);
    setCheckFetchForTests(async () => new Response("slow down", { status: 429 }));
    const spec = tile("pg-woman-style-semi_real");
    expect(await drawTile(t.db, spec)).toBe("failed");
    await t.db.query(`update look_tiles set updated_at = now() - interval '1 hour' where id = $1`, [spec.id]);
    await t.db.query(`delete from adult_media_cooldowns`);
    hive(ADULTS, NSFW);
    expect(await drawTile(t.db, spec)).toBe("refused");
    expect(calls).toHaveLength(1);
  });

  it("draws a portrait from the picks free, and the ledger says Workers AI drew it", async () => {
    await keys();
    workerOn();
    const calls = fakeWorker(drawn);
    hive();
    const cookie = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ extras: { looks: { gender: "woman", style: "semi_real" } } }), cookie)).json()).id;
    const res = await postLooksPortrait(new Request(`${BASE_URL}/api/characters/${id}/looks-portrait`, { method: "POST", headers: { cookie } }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: "worker", size: "640x800" });
    expect(calls[0].prompt).toMatch(/^Semi-realistic painterly 2\.5D digital illustration of /);
    const asset = (await t.db.query<{ source_model: string }>(`select source_model from character_assets where character_id = $1 and kind = 'portrait'`, [id])).rows[0];
    expect(asset.source_model).toBe("workers-ai:flux-2-klein-4b");
  });
});

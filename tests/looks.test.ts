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
  IMAGE_MIN_AGE,
  LOOK_STEPS,
  looksAppearance,
  nearestBaseline,
  normaliseLooks,
  optionsFor,
  stepsFor,
  tileId,
  tileSpecs,
  GENDERS,
} from "@/lib/looks";
import { drawMissingTiles, drawTile, LOOKS_PG_MODEL, PORTRAITS_PER_CHARACTER, setLooksFetchForTests, setLooksPauseForTests } from "@/lib/looks-draw";
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
const keys = () => saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive", venice_key: "placeholder-venice" });

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
    expect(line).toBe("Latina, long voluminous curly copper-red hair, vivid green eyes, a curvy hourglass figure with full hips");
    expect(line.length).toBeLessThanOrEqual(140);
    expect(normaliseLooks({ gender: "woman", facial_hair: "full_beard", hair_style: "buzz", eyes: "blue" })).toEqual({ gender: "woman", eyes: "blue" });
    expect(normaliseLooks({ gender: "man", after_dark: { butt: "large", outfit: "towel" } })).toEqual({ gender: "man", after_dark: { outfit: "towel" } });
    expect(LOOK_STEPS.find((s) => s.id === "butt")?.afterDark).toBe(true);
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
    // Hive kept answering 429: its daily limit, so pictures are paused (lib/adult/hive-limit.ts) and a batch draws and
    // sends nothing until that's over.
    let sent = 0;
    setCheckFetchForTests(async () => {
      sent++;
      return new Response("?", { status: 500 });
    });
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

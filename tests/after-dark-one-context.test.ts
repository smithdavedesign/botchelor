import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { GET as picturePromptGet } from "@/app/api/admin/after-dark/picture-prompt/route";
import { GET as sceneMatchGet } from "@/app/api/admin/after-dark/scene-match/route";
import { autoPicturesSettled, kickAutoPicture, PICTURE_GAP } from "@/lib/adult/auto-pictures";
import { beatPicturesSettled, OLDER_WORDS } from "@/lib/adult/beats";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setFramingViewForTests } from "@/lib/adult/framing";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { loadCharacter } from "@/lib/character";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// David, 2026-10-25: "look at the flow and prompts and data given and let's make sure we can guide it if needed and also
// tighten it up". One context for every scene picture: drawn from their faces (and bodies, undressed), dressed in their
// own outfits, the place with what it puts them in, the lines' asks leading.
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
  setCheckSleepForTests(async () => {});
});
afterEach(async () => {
  setFramingViewForTests(null);
  await beatPicturesSettled();
  await autoPicturesSettled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  setReelPausesForTests(true);
});

const RAFE = HOUSE_CHARACTERS[0].id;
const LEXI = "lexi-own";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.5 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string, handler: (r: Request) => Promise<Response> = POST, path = "/api/admin/after-dark") =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));

/** Venice's multi-edit and Hive stubbed: each scene picture's prompt and the pictures it was made from. */
function fakeMedia() {
  const edits: { prompt: string; images: string[] }[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD));
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).endsWith("/image/multi-edit")) return new Response("?", { status: 500 });
    const body = JSON.parse(String(init?.body ?? "{}")) as { prompt: string; images?: string[] };
    edits.push({ prompt: body.prompt, images: body.images ?? [] });
    return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
  });
  return edits;
}

/** Lexi (theirs, with an everyday outfit and After Dark's lingerie), set up with a face and a body; Rafe's baseline; their scene. */
async function setup(lines: { who: "a" | "b"; text: string; stage: number }[], place: string) {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  const cookie = signedIn(id);
  await post({ enabled: true, openrouter_key: "placeholder-text-ABCD", image_provider: "venice", venice_key: "placeholder-venice", hive_key: "placeholder-hive", auto_scene_pictures: false }, cookie, settingsPost, "/api/admin/after-dark/settings");
  const looks = { gender: "woman", ethnicity: "caucasian", hair_style: "straight", hair_color: "blonde", eyes: "blue", body: "curvy", outfit: "casual", after_dark: { outfit: "lingerie" } };
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, pronouns, extras) values ($1, $2, false, 'Lexi', 26, 'Bakes.', '["warm"]'::jsonb, 'x', 'x', 'she/her', $3::jsonb)`,
    [LEXI, id, JSON.stringify({ looks })],
  );
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [id, LEXI]);
  for (const [pid, c, kind] of [["base-lexi", LEXI, "baseline"], ["base-rafe", RAFE, "baseline"], ["body-lexi", LEXI, "scene"]] as const) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, $4, 'p', 'image/png', $5)`, [pid, id, c, kind, Buffer.from(PNG)]);
  }
  await t.db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, $2, 'base-lexi')`, [id, LEXI]);
  await t.db.query(`insert into adult_identity (owner_id, character_id, body_image_id) values ($1, $2, 'body-lexi')`, [id, LEXI]);
  const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${LEXI}&b=${RAFE}`, { headers: { cookie } }))).json()).scene as { id: string };
  await t.db.query(`update adult_scenes set stage = $3, place = $4, set_place = $4, lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify(lines), lines.at(-1)!.stage, place]);
  return { id, cookie };
}
const at = (stage: number) => [
  { who: "a" as const, text: "*leans on the bar* So.", stage },
  { who: "b" as const, text: "*grins* So.", stage },
];
const previewOf = async (cookie: string) => (await (await post({ a: LEXI, b: RAFE, picture_preview: { line: 1 } }, cookie)).json()).preview as { fields: { wearing: string }; prompt: string };

describe("one context for every scene picture", () => {
  it("dressed in their own outfits: what they wear out, in public or before it's gone past flirting", async () => {
    const { cookie } = await setup(at(0), "a rooftop bar");
    const p = await previewOf(cookie);
    expect(p.fields.wearing).toMatch(/in a fitted white t-shirt and blue jeans/);
    expect(p.prompt).toMatch(/not their clothes: .*in a fitted white t-shirt and blue jeans.*both fully clothed/);
    expect(p.prompt).not.toMatch(/lingerie/);
  });

  it("After Dark's outfit somewhere private from kissing on; the stage's own words from undressing on", async () => {
    const kissing = await setup(at(2), "Lexi's bedroom");
    expect((await previewOf(kissing.cookie)).fields.wearing).toMatch(/in black lace lingerie/);
    await t.reset();
    const undressing = await setup(at(3), "Lexi's bedroom");
    const p = await previewOf(undressing.cookie);
    expect(p.fields.wearing).toBe("Half undressed");
    expect(p.prompt).not.toMatch(/lingerie|t-shirt/);
  });

  it("from undressing on, drawn from her body reference; before it, from her face", async () => {
    const dressed = await setup(at(2), "Lexi's bedroom");
    const edits = fakeMedia();
    await post({ a: LEXI, b: RAFE, picture_now: { line: 1 } }, dressed.cookie);
    await beatPicturesSettled();
    expect(edits[0].images.join(" ")).toContain("base-lexi");
    expect(edits[0].images.join(" ")).not.toContain("body-lexi");
    await t.reset();
    const undressed = await setup(at(3), "Lexi's bedroom");
    const later = fakeMedia();
    await post({ a: LEXI, b: RAFE, picture_now: { line: 1 } }, undressed.cookie);
    await beatPicturesSettled();
    expect(later[0].images.join(" ")).toContain("body-lexi");
  });

  it("a new place's picture waits until the chapter's last is PICTURE_GAP lines back; the owner's own Set the scene doesn't", async () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*kisses her ${i}* Again.`, stage: 4 }));
    const { id, cookie } = await setup(lines, "the seaside cottage");
    await post({ auto_scene_pictures: true }, cookie, settingsPost, "/api/admin/after-dark/settings");
    fakeMedia();
    const sceneId = (await t.db.query<{ id: string }>(`select id from adult_scenes`)).rows[0].id;
    const [a, b] = [await loadCharacter(t.db, LEXI), await loadCharacter(t.db, RAFE)];
    const kick = (place: string, n: number, ownerSet = false) =>
      kickAutoPicture(t.db, id, { id: sceneId, chapter: 1, place, set_place: place, stage: 4, lines: [...lines, ...lines, ...lines].slice(0, n), ownerSet }, a, b);
    expect(await kick("the seaside cottage", 4)).toBe(true);
    await autoPicturesSettled();
    expect(await kick("the cozy bedroom", 6)).toBe(false);
    expect(await kick("the cozy bedroom", 6, true)).toBe(true);
    await autoPicturesSettled();
    expect(await kick("the garden", 6 + PICTURE_GAP)).toBe(true);
  });

  it("a place's own picture waits when the theater offered one of the same moment (the test night, 2026-10-26)", async () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*kisses her ${i}* Again.`, stage: 3 }));
    const { id, cookie } = await setup(lines, "his apartment");
    await post({ auto_scene_pictures: true }, cookie, settingsPost, "/api/admin/after-dark/settings");
    fakeMedia();
    const sceneId = (await t.db.query<{ id: string }>(`select id from adult_scenes`)).rows[0].id;
    await t.db.query(`insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, place) values ('b1', $1, $2, $3, $4, 1, 5, 'undress', 'undressing', 3, 'his apartment')`, [id, sceneId, LEXI, RAFE]);
    const [a, b] = [await loadCharacter(t.db, LEXI), await loadCharacter(t.db, RAFE)];
    expect(await kickAutoPicture(t.db, id, { id: sceneId, chapter: 1, place: "his apartment", set_place: "his apartment", stage: 3, lines }, a, b)).toBe(false);
  });

  describe("an age check that reads one of them as young (David, 2026-10-26: \"proper error handling if they flag as too young\")", () => {
    /** The age check answering MINOR for the first `minors` pictures, then ADULTS. */
    function ageCheck(minors: number) {
      const edits = fakeMedia();
      let asked = 0;
      setCheckFetchForTests(async (input: RequestInfo | URL) =>
        Response.json(String(input) === HIVE_VLM ? (asked++ < minors ? { choices: [{ message: { role: "assistant", content: '{"answer": "MINOR"}' } }] } : ADULTS) : CLEAN_MOD),
      );
      return edits;
    }

    it("is drawn once more, plainly older, through the same check, and kept when that passes", async () => {
      const { cookie } = await setup(at(2), "Lexi's bedroom");
      const edits = ageCheck(1);
      await post({ a: LEXI, b: RAFE, picture_now: { line: 1 } }, cookie);
      await beatPicturesSettled();
      const scene = edits.filter((e) => /from Picture 2 together/.test(e.prompt));
      expect(scene).toHaveLength(2);
      expect(scene[0].prompt).not.toContain(OLDER_WORDS);
      expect(scene[1].prompt).toContain(OLDER_WORDS);
      expect(scene[1].prompt.length).toBeLessThanOrEqual(1500);
      expect((await t.db.query<{ status: string }>(`select status from adult_beats where kind = 'chosen' order by created_at desc limit 1`)).rows[0].status).toBe("drawn");
    });

    it("refused both times: the beat says who and what fixes it, and so does the scene", async () => {
      const { cookie } = await setup(at(2), "Lexi's bedroom");
      ageCheck(9);
      await post({ a: LEXI, b: RAFE, picture_now: { line: 1 } }, cookie);
      await beatPicturesSettled();
      const beat = (await t.db.query<{ status: string; fail_reason: string }>(`select status, fail_reason from adult_beats where kind = 'chosen' order by created_at desc limit 1`)).rows[0];
      expect(beat.status).toBe("failed");
      expect(beat.fail_reason).toMatch(/^The age check read Lexi as possibly under 18, so the picture wasn't kept, even drawn again older\. Open Lexi's Studio/);
      const page = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${LEXI}&b=${RAFE}`, { headers: { cookie } }))).json()).scene;
      expect(page.picture_note).toBe(beat.fail_reason);
      expect(page.beats.find((b: { status: string }) => b.status === "failed")?.reason).toBe(beat.fail_reason);
    });
  });

  it("at sex, a dressed body reference gives way to the nude baseline; a nude one is used (Sweet's camisole, 2026-10-26)", async () => {
    // Both of them in frame (lib/adult/framing.ts would pick first person for this act): it's about their bodies.
    setFramingViewForTests(() => "pair");
    const dressed = await setup(at(4), "Lexi's bedroom");
    const edits = fakeMedia();
    await post({ a: LEXI, b: RAFE, picture_now: { line: 1 } }, dressed.cookie);
    await beatPicturesSettled();
    const scene = edits.find((e) => /from Picture 2 together/.test(e.prompt))!;
    expect(scene.images.join(" ")).not.toContain("body-lexi");
    expect(scene.prompt).toContain("both completely naked, none of the clothes from their pictures");
    await t.reset();
    const nude = await setup(at(4), "Lexi's bedroom");
    await t.db.query(`update adult_images set prompt = 'Make one photograph of the woman from Picture 1. Wearing fully nude. Full body, head to toe.' where id = 'body-lexi'`);
    const later = fakeMedia();
    await post({ a: LEXI, b: RAFE, picture_now: { line: 1 } }, nude.cookie);
    await beatPicturesSettled();
    expect(later.find((e) => /from Picture 2 together/.test(e.prompt))!.images.join(" ")).toContain("body-lexi");
  });

  it("a picture the lines ask for, of both, is drawn from their faces, its description leading, instead of the chapter's own", async () => {
    const { cookie } = await setup(at(0), "a rooftop bar");
    await post({ auto_scene_pictures: true }, cookie, settingsPost, "/api/admin/after-dark/settings");
    const edits = fakeMedia();
    let n = 0;
    setAdultModelForTests({
      complete: async (m: ChatMessage[]) => {
        if (/running recap|factual memory|what a private night left behind/.test(m[0].content)) return "{}";
        n++;
        return JSON.stringify({
          lines: [
            { who: "a", text: `*holds up her phone ${n}* Smile for me.` },
            { who: "b", text: `*leans in beside her ${n}* Like this?` },
          ],
          picture: { of: "both", description: "the two of them squeezed into one selfie at the bar, laughing" },
        });
      },
    } as never);
    const r = await (await post({ a: LEXI, b: RAFE }, cookie)).json();
    expect(r.auto_picture).toBe(true);
    await autoPicturesSettled();
    await beatPicturesSettled();
    // The asked picture draws after the response, on its own: wait for it.
    for (let i = 0; i < 100 && !(await t.db.query(`select 1 from adult_beats where kind = 'asked' and status = 'drawn'`)).rows.length; i++) await new Promise((r) => setTimeout(r, 20));
    const asked = edits.find((e) => /squeezed into one selfie/.test(e.prompt));
    expect(asked?.prompt).toMatch(/^Make one photograph of the .+ from Picture 1 and the .+ from Picture 2 together/);
    expect(asked?.prompt).toContain("Most important, do exactly this: the two of them squeezed into one selfie at the bar, laughing.");
    const kinds = (await t.db.query<{ kind: string; status: string }>(`select kind, status from adult_beats where scene_id = $1 order by created_at`, [r.scene.id])).rows;
    // The one they asked for is this moment's picture: the chapter's own of the same lines isn't drawn too (2026-10-26).
    expect(kinds).toEqual([{ kind: "asked", status: "drawn" }]);
  });

  // The audit, 2026-10-29: the two After Dark routes with no test of their own.
  it("the picture prompt and the scene match: an admin's answer, everyone else's not-found", async () => {
    const { cookie } = await setup(at(2), "Lexi's bedroom");
    const q = `?a=${LEXI}&b=${RAFE}`;
    const asAdmin = (h: (r: Request) => Promise<Response>, path: string) => h(new Request(`${BASE_URL}${path}${q}`, { headers: { cookie } }));
    const prompt = await asAdmin(picturePromptGet, "/api/admin/after-dark/picture-prompt");
    expect(prompt.status).toBe(200);
    const body = (await prompt.json()) as { prompt: string; fields: { wearing: string }; stage: number };
    expect(body.prompt).toMatch(/^Make one photograph of/);
    expect(body.stage).toBe(2);
    const match = await asAdmin(sceneMatchGet, "/api/admin/after-dark/scene-match");
    expect(match.status).toBe(200);
    expect(await match.json()).toMatchObject({ match: null });
    // A visitor, and someone signed in who isn't an admin (nor After Dark's): nothing, not even that it's there.
    const visitor = newUserCookie();
    const stranger = signedIn(userIdOf(newUserCookie()));
    for (const c of [visitor, stranger]) {
      expect((await picturePromptGet(new Request(`${BASE_URL}/api/admin/after-dark/picture-prompt${q}`, { headers: { cookie: c } }))).status).toBe(404);
      expect((await sceneMatchGet(new Request(`${BASE_URL}/api/admin/after-dark/scene-match${q}`, { headers: { cookie: c } }))).status).toBe(404);
    }
  });

  it("the hub's nights under way: both faces kept for this viewer, the last line, its chapter and when (the audit, 2026-10-29)", async () => {
    const { id } = await setup(at(2), "Lexi's bedroom");
    const { listCastPairs } = await import("@/lib/adult/scenes");
    const pairs = await listCastPairs(t.db, id);
    const night = pairs.find((p) => p.lines > 0)!;
    // The pair is kept lower id first (house-rafe, lexi-own): the last line, "b"'s, is Lexi's.
    expect(night.last).toEqual({ who: "Lexi", text: "So." });
    expect(night.chapter).toBe(1);
    expect(night.updated_at).toMatch(/^\d{4}-/);
    // Lexi's face is the one she picked (adult_face_refs), behind the privacy blur's /after-dark/ hook; Rafe has none kept.
    const lexi = [night.a, night.b].find((c) => c.id === LEXI)!;
    expect(lexi.photo).toBe("/api/admin/after-dark/media/base-lexi");
    expect(pairs.find((p) => p.lines === 0)?.last).toBeUndefined();
  });
});


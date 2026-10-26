import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { autoPicturesSettled } from "@/lib/adult/auto-pictures";
import { beatPicturesSettled } from "@/lib/adult/beats";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
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

  it("a picture the lines ask for, of both, is drawn from their faces, its description leading; a chapter's own too", async () => {
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
    const asked = edits.find((e) => /squeezed into one selfie/.test(e.prompt));
    expect(asked?.prompt).toMatch(/^Make one photograph of the .+ from Picture 1 and the .+ from Picture 2 together/);
    expect(asked?.prompt).toContain("Most important, do exactly this: the two of them squeezed into one selfie at the bar, laughing.");
    const kinds = (await t.db.query<{ kind: string; status: string }>(`select kind, status from adult_beats order by created_at`)).rows;
    expect(kinds).toEqual(expect.arrayContaining([{ kind: "chapter", status: "drawn" }, { kind: "asked", status: "drawn" }]));
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { beatPicturesSettled } from "@/lib/adult/beats";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setBriefModelForTests } from "@/lib/adult/picture-brief";
import { keyframePrompt, keptDetails, reelCast, setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { loadCharacter } from "@/lib/character";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// David, 2026-11-03: "draw ahead can change what they're wearing in the same chapter … what they're wearing should be
// defined at the start of chapter one", "if there is a roleplay set (boss and employee, office attire) … that should also
// dictate what they are wearing", and "details like glasses and tattoos and earrings were ignored". No live calls.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setBriefModelForTests(null);
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

/** Lexi (theirs, in jeans), set up with a face and a body; Rafe's baseline; their scene at these lines. */
async function setup(lines: { who: "a" | "b"; text: string; stage: number }[], place: string) {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  const cookie = signedIn(id);
  await post({ enabled: true, openrouter_key: "placeholder-text-ABCD", image_provider: "venice", venice_key: "placeholder-venice", hive_key: "placeholder-hive", auto_scene_pictures: false }, cookie, settingsPost, "/api/admin/after-dark/settings");
  const looks = { gender: "woman", ethnicity: "caucasian", hair_style: "straight", hair_color: "blonde", eyes: "blue", body: "curvy", outfit: "casual" };
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
  return { id, cookie, scene: scene.id };
}

/** The brief's writer, scripted: what it was asked, and its reply (or a throw). */
function scriptBrief(reply: Record<string, string> | Error | string) {
  const asked: ChatMessage[][] = [];
  setBriefModelForTests({
    complete: async (messages) => {
      asked.push(messages);
      if (reply instanceof Error) throw reply;
      return typeof reply === "string" ? reply : `Here it is: ${JSON.stringify(reply)}`;
    },
  });
  return asked;
}

const OPENING = [
  { who: "a" as const, text: "*stamps the snow off his boots, cheeks red from the rink* That was the best fall I've ever taken.", stage: 1 },
  { who: "b" as const, text: "*laughs, still in her skates' wool socks* You held my hand the whole way down.", stage: 1 },
];
const BRIEF = (wearing: string) => ({ place: "her living room", wearing, kept_on: "", happening: "they stand close by the sofa", mood: "warm", act: "" });
const RINK = "Lexi in a cream cable-knit jumper and wool socks; Rafe in a navy parka over a grey hoodie";
type Preview = { fields: { wearing: string }; prompt: string };
const previewOf = async (cookie: string, line: number) => (await (await post({ a: LEXI, b: RAFE, picture_preview: { line } }, cookie)).json()).preview as Preview;
const addLines = (scene: string, more: { who: "a" | "b"; text: string; stage: number }[]) =>
  t.db.query(`update adult_scenes set lines = lines || $2::jsonb, stage = $3 where id = $1`, [scene, JSON.stringify(more), more.at(-1)!.stage]);

const CAPTAIN = "a fitted dark captain's uniform with rank insignia on the collar";
const PILOT = "a zip-front flight suit with mission patches";
const cap = (noun: string) => `The ${noun}`;
/** "woman"/"man" for the scene's first and second (the scene orders the pair itself). */
async function pairNouns(scene: string): Promise<[string, string]> {
  const a = (await t.db.query<{ character_a: string }>(`select character_a from adult_scenes where id = $1`, [scene])).rows[0].character_a;
  return a === LEXI ? ["woman", "man"] : ["man", "woman"];
}

describe("what they wear tonight", () => {
  it("is fixed at the night's first picture, from what the brief read there, and a later moment keeps it", async () => {
    const { cookie, scene } = await setup(OPENING, "Lexi's living room");
    scriptBrief(BRIEF(RINK));
    expect((await previewOf(cookie, 1)).fields.wearing).toBe(RINK);
    // Further on, past kissing somewhere private (where their looks would have switched to After Dark's outfit), and the
    // brief reading the latest lines differently: the clothes stay the night's.
    await addLines(scene, [
      { who: "a", text: "*pulls her closer by the waist* Come here.", stage: 2 },
      { who: "b", text: "*kisses him slowly* Mm.", stage: 2 },
    ]);
    scriptBrief(BRIEF("Lexi in a red slip dress; Rafe in a white shirt"));
    const later = await previewOf(cookie, 3);
    expect(later.fields.wearing).toBe(RINK);
    expect(later.prompt).toContain("the woman in a cream cable-knit jumper and wool socks; the man in a navy parka over a grey hoodie, both still dressed");
    expect(later.prompt).not.toContain("slip dress");
  });

  it("changes when the lines say someone changes clothes, and is fixed again from there", async () => {
    const { cookie, scene } = await setup(OPENING, "Lexi's living room");
    scriptBrief(BRIEF(RINK));
    await previewOf(cookie, 1);
    await addLines(scene, [{ who: "b", text: "*slips into a black silk robe from the bedroom* Better.", stage: 1 }]);
    const ROBE = "Lexi in a black silk robe; Rafe in a navy parka over a grey hoodie";
    scriptBrief(BRIEF(ROBE));
    expect((await previewOf(cookie, 2)).fields.wearing).toBe(ROBE);
    // …and kept from there, even when the brief later drifts.
    await addLines(scene, [{ who: "a", text: "*sits beside her* Nice.", stage: 1 }]);
    scriptBrief(BRIEF("Lexi in jeans; Rafe in a t-shirt"));
    expect((await previewOf(cookie, 3)).fields.wearing).toBe(ROBE);
  });

  it("is a roleplay's own for its chapter: the boss and the employee in office clothes", async () => {
    const { cookie, scene } = await setup(OPENING, "Lexi's living room");
    scriptBrief(BRIEF(RINK));
    await previewOf(cookie, 1);
    await t.db.query(`update adult_scenes set roleplay = $2::jsonb where id = $1`, [scene, JSON.stringify({ id: "boss", chapter: 1, swap: false })]);
    const OFFICE = "Lexi in a fitted grey pencil skirt and white blouse; Rafe in a charcoal suit, tie loosened";
    const asked = scriptBrief(BRIEF(OFFICE));
    expect((await previewOf(cookie, 1)).fields.wearing).toBe(OFFICE);
    expect(asked[0].map((m) => m.content).join("\n")).toContain("Boss and employee, after hours");
    scriptBrief(BRIEF("Lexi in a red slip dress; Rafe in a white shirt"));
    expect((await previewOf(cookie, 1)).fields.wearing).toBe(OFFICE);
  });

  it("starts a roleplay in character: the captain and the pilot in their uniforms, not her own outfit (David, 2026-11-10)", async () => {
    const { cookie, scene } = await setup(OPENING, "a space station's crew quarters");
    await t.db.query(`update adult_scenes set roleplay = $2::jsonb where id = $1`, [scene, JSON.stringify({ id: "starship", chapter: 1, swap: false })]);
    // The lines say nothing about clothes, so the brief has nothing to read: their parts' costumes, not their looks.
    const asked = scriptBrief(BRIEF(""));
    const res = await (await post({ a: LEXI, b: RAFE, picture_preview: { line: 1 } }, cookie)).json();
    // The first of the scene's pair plays the captain.
    const [x, y] = await pairNouns(scene);
    expect(res.preview.fields.wearing).toBe(`${cap(x)} in ${CAPTAIN}; the ${y} in ${PILOT}`);
    expect(res.preview.wearing_from).toBe("roleplay");
    expect(res.preview.prompt).toContain(`not their clothes: ${cap(x)} in ${CAPTAIN}; the ${y} in ${PILOT}, both fully clothed.`);
    // The brief is told the costumes as what they'd usually have on, so it names them too.
    expect(asked[0].map((m) => m.content).join("\n")).toContain("captain's uniform");
    expect(((await t.db.query(`select outfits from adult_scenes where id = $1`, [scene])).rows[0] as { outfits: { from: string; for: string } }).outfits).toMatchObject({ from: "roleplay", for: "Captain and pilot" });
  });

  it("swaps the costumes with the roles, and dresses a chapter already fixed in their own outfits in character", async () => {
    const { cookie, scene } = await setup(OPENING, "a space station's crew quarters");
    await t.db.query(`update adult_scenes set roleplay = $2::jsonb, outfits = $3::jsonb where id = $1`, [
      scene,
      JSON.stringify({ id: "starship", chapter: 1, swap: true }),
      JSON.stringify({ for: "Captain and pilot", from: "looks", line: 0, chapter: 1, wearing: "The woman in a tiny string bikini; the man in clean casual clothes" }),
    ]);
    scriptBrief(BRIEF(""));
    const wearing = (await previewOf(cookie, 1)).fields.wearing;
    const [x, y] = await pairNouns(scene);
    expect(wearing).toBe(`${cap(x)} in ${PILOT}; the ${y} in ${CAPTAIN}`);
    expect(wearing).not.toContain("bikini");
  });

  it("is kept with the chapter when it's filed, and gone when the night ends", async () => {
    const { cookie, scene } = await setup(OPENING, "Lexi's living room");
    scriptBrief(BRIEF(RINK));
    await previewOf(cookie, 1);
    expect(((await t.db.query(`select outfits from adult_scenes where id = $1`, [scene])).rows[0] as { outfits: { wearing: string } }).outfits.wearing).toBe(RINK);
    await post({ a: LEXI, b: RAFE, reset: true }, cookie);
    const after = (await t.db.query(`select outfits from adult_scenes where id = $1`, [scene])).rows[0] as { outfits: unknown } | undefined;
    expect(after?.outfits ?? null).toBeNull();
    const night = (await t.db.query(`select outfits from adult_nights where owner_id is not null order by created_at desc limit 1`)).rows[0] as { outfits: { wearing: string } } | undefined;
    if (night) expect(night.outfits.wearing).toBe(RINK);
  });
});

describe("what stays on them", () => {
  it("names their glasses, piercings and tattoos in every picture of the two of them, dressed or not", async () => {
    const { id } = await setup(OPENING, "Lexi's living room");
    await t.db.query(`update characters set extras = jsonb_set(extras, '{looks}', extras->'looks' || $2::jsonb) where id = $1`, [LEXI, JSON.stringify({ glasses: "wire", piercings: "ears", tattoos: "sleeve" })]);
    const [lexi, rafe] = await Promise.all([loadCharacter(t.db, LEXI), loadCharacter(t.db, RAFE)]);
    const cast = reelCast(lexi!, rafe!, id);
    expect(keptDetails(cast)).toBe(" Keep these too, clothes or not: the woman has thin round wire-framed glasses and small gold hoop earrings and a full sleeve tattoo covering one arm; the man has none of these.");
    for (const stage of [0, 4]) expect(keyframePrompt(cast, "They kiss.", null, stage, false)).toContain("the woman has thin round wire-framed glasses");
    expect(keptDetails(reelCast(rafe!, rafe!, id))).toBe("");
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { beatPicturesSettled, briefClothes } from "@/lib/adult/beats";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { briefMessages, holdBrief, parseBrief, setBriefModelForTests, type BriefInput } from "@/lib/adult/picture-brief";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// David, 2026-10-29: "the copy or story doesn't give a full picture … add a quick call to a llm to summarize the scene,
// location, what's happening … it's important to know what they're wearing if there is a cosplay ongoing". No live calls.
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

const COSPLAY = [
  { who: "a" as const, text: "*comes out of the bathroom in a red Sailor-style superhero cape and a gold mask* Ta-da.", stage: 1 },
  { who: "b" as const, text: "*laughs, pulling on the matching blue cape* You went all in.", stage: 1 },
  { who: "a" as const, text: "*steps closer, cape swishing* Every hero needs a sidekick.", stage: 2 },
];
const BRIEF = {
  place: "her living room, a sofa and a lamp, the coffee table pushed aside",
  wearing: "Lexi in a red superhero cape and a gold mask over her jeans; Rafe in a matching blue cape",
  kept_on: "",
  happening: "Lexi steps in close to Rafe, her cape swinging, her hand on his chest; he's grinning down at her",
  mood: "playful, a costume game",
};
type Preview = { fields: { happening: string; wearing: string; place: string; mood: string }; prompt: string };
const previewOf = async (cookie: string, line = 2) => {
  const res = await post({ a: LEXI, b: RAFE, picture_preview: { line } }, cookie);
  return (await res.json()).preview as Preview;
};

describe("a scene picture's brief", () => {
  it("is what the form shows and what's sent: the costume they put on, where they are, what's happening", async () => {
    const { cookie } = await setup(COSPLAY, "Lexi's living room");
    const asked = scriptBrief(BRIEF);
    const p = await previewOf(cookie);
    expect(p.fields).toMatchObject({ wearing: BRIEF.wearing, place: BRIEF.place, happening: BRIEF.happening, mood: "playful, a costume game" });
    // Sent with their names out: the costume, the place, the moment, still dressed.
    expect(p.prompt).toMatch(/not their clothes: the woman in a red superhero cape and a gold mask over her jeans; the man in a matching blue cape, both still dressed/);
    expect(p.prompt).toContain("The place: her living room, a sofa and a lamp");
    expect(p.prompt).toContain("What is happening: the woman steps in close to the man");
    expect(p.prompt).not.toMatch(/\bLexi\b|\bRafe\b/);
    // It read the whole chapter up to the moment, the costume included, and was told which line is the moment.
    const said = asked[0].map((m) => m.content).join("\n");
    expect(said).toContain("red Sailor-style superhero cape");
    expect(said).toContain("The last line, 3, is the moment");
    expect(said).toMatch(/What each usually wears: .*Lexi: a fitted white t-shirt and blue jeans/);
  });

  it("is read once per moment: the same moment again, and its picture, use the one kept; changed lines read it again", async () => {
    const { cookie, scene } = await setup(COSPLAY, "Lexi's living room");
    const asked = scriptBrief(BRIEF);
    await previewOf(cookie);
    await previewOf(cookie);
    expect(asked).toHaveLength(1);
    const edits: string[] = [];
    setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD));
    setReelFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
      edits.push((JSON.parse(String(init?.body ?? "{}")) as { prompt: string }).prompt);
      return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    });
    await post({ a: LEXI, b: RAFE, picture_now: { line: 2 } }, cookie);
    await beatPicturesSettled();
    expect(asked).toHaveLength(1);
    expect(edits[0]).toContain("a red superhero cape and a gold mask");
    // A redo wrote the moment differently: read again.
    await t.db.query(`update adult_scenes set lines = $2::jsonb where id = $1`, [scene, JSON.stringify([...COSPLAY.slice(0, 2), { ...COSPLAY[2], text: "*tugs his cape* Sidekick." }])]);
    await previewOf(cookie);
    expect(asked).toHaveLength(2);
  });

  it("gives way to the owner's own words, field by field", async () => {
    const { cookie } = await setup(COSPLAY, "Lexi's living room");
    scriptBrief(BRIEF);
    const res = await post({ a: LEXI, b: RAFE, picture_preview: { line: 2, edit: { wearing: "both in pirate costumes" } } }, cookie);
    const p = (await res.json()).preview as Preview;
    expect(p.prompt).toMatch(/not their clothes: both in pirate costumes/);
    expect(p.prompt).toContain("The place: her living room");
  });

  it("isn't needed: unreadable, failed or crossing a line, the old guess stands (that field only, when it's one field)", async () => {
    const { cookie } = await setup(COSPLAY, "Lexi's living room");
    scriptBrief(new Error("timed out"));
    const failed = await previewOf(cookie);
    expect(failed.fields.wearing).toMatch(/in a fitted white t-shirt and blue jeans/);
    expect(failed.fields.place).toBe("Lexi's living room");
    scriptBrief("I can't help with that.");
    expect((await previewOf(cookie)).fields.wearing).toMatch(/t-shirt and blue jeans/);
    // A costume that crosses one of David's lines is never used; the rest of the brief is.
    scriptBrief({ ...BRIEF, wearing: "Lexi in a school uniform with pigtails" });
    const held = await previewOf(cookie);
    expect(held.fields.wearing).toMatch(/t-shirt and blue jeans/);
    expect(held.fields.happening).toBe(BRIEF.happening);
    expect(held.prompt).not.toMatch(/school|pigtails/);
  });

  it("once they're naked, only what it says is still on, else the stage's own words", async () => {
    const lines = [...COSPLAY, { who: "b" as const, text: "*pulls her down onto the sofa, both of them naked now but for her mask*", stage: 4 }];
    const { cookie } = await setup(lines, "Lexi's living room");
    scriptBrief({ ...BRIEF, wearing: "both naked; Lexi still has the gold mask on", kept_on: "her gold mask" });
    const p = await previewOf(cookie, 3);
    expect(p.fields.wearing).toBe("both naked; Lexi still has the gold mask on");
    expect(p.prompt).toMatch(/not their clothes: both completely naked apart from her gold mask, none of the other clothes from their pictures/);
  });
});

describe("the brief's parts", () => {
  const input: BriefInput = {
    owner: "o",
    scene: "s",
    night: null,
    chapter: 1,
    lines: COSPLAY,
    names: { a: "Lexi Moon", b: "Rafe" },
    pronouns: { a: "she/her", b: null },
    usual: null,
    place: "a rooftop bar",
    roleplay: "Rivals. Lexi and Rafe have competed for everything.",
    dressed: "Both fully clothed",
    shows: "A kiss",
  };
  it("asks about the moment: who they are, the roleplay, the chapter by first name, the last line marked", () => {
    const [system, user] = briefMessages(input);
    expect(system.content).toMatch(/adults-only/);
    expect(user.content).toContain("The two of them: Lexi Moon (she/her) and Rafe.");
    expect(user.content).toContain("This chapter's roleplay: Rivals.");
    expect(user.content).not.toContain("What each usually wears");
    expect(user.content).toContain("3. Lexi: *steps closer");
  });
  it("reads a reply wrapped in words; nothing kept on is nothing; no wearing and no happening is no brief", () => {
    expect(parseBrief(`Sure! {"place": "a bar", "wearing": "jeans", "kept_on": "none", "happening": "a kiss", "mood": "warm"} Hope that helps.`)).toEqual({
      place: "a bar",
      wearing: "jeans",
      kept_on: "",
      happening: "a kiss",
      mood: "warm",
    });
    expect(parseBrief(`{"place": "a bar"}`)).toBeNull();
    expect(parseBrief("no")).toBeNull();
    expect(holdBrief({ place: "a bar", wearing: "a school uniform", kept_on: "", happening: "a kiss", mood: "" }, (w) => !/school/.test(w)).wearing).toBe("");
  });
  it("dresses them by the stage", () => {
    expect(briefClothes({ wearing: "a red cape.", kept_on: "" }, 1)).toBe("a red cape, both still dressed");
    expect(briefClothes({ wearing: "her blouse open", kept_on: "" }, 3)).toBe("her blouse open");
    expect(briefClothes({ wearing: "both naked", kept_on: "" }, 4)).toBeUndefined();
    expect(briefClothes(null, 1)).toBeUndefined();
  });
});

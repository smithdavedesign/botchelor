import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NEGATIVE_PROMPT } from "@/lib/adult/media";
import { ART_STYLE_LABEL, ART_STYLES, artStyleFrom, BUILDER_ART_STYLES, artStyleInWords, artStyleOf, DRAWN_STYLES, isDrawnStyle, STYLE_WORDS } from "@/lib/art-style";
import { searchDirectory } from "@/lib/directory";
import { suggestLooks } from "@/lib/express-create";
import { FACE_LOOP_PROMPT, FACE_PORTRAIT_PROMPT, FACE_PROMPTS, facePromptsPass, styledFace } from "@/lib/face-kit";
import { LOOK_STEPS } from "@/lib/looks";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { MCP_CHANGELOG } from "@/lib/mcp/changelog";
import { MCP_SERVER_INFO } from "@/lib/mcp/dispatcher";
import { ANIME_NEGATIVE_PROMPT, negativePromptFor, recastPortraitPrompt, SEMI_REAL_NEGATIVE_PROMPT } from "@/lib/recast";
import { checkPgPictureText } from "@/lib/safety";
import { identityViewPrompt } from "@/lib/studio/identity-views";
import { PG_TAIL, pgCarouselPrompt, pgShootPrompt, type PgPlan } from "@/lib/studio/pg-catalog";
import { startTestDb, validCharacter } from "./helpers";

// One art style per character (PRD styles-and-storylines, phase 2): realistic, anime or 2.5D, read from their looks
// (lib/art-style.ts). Every picture of them follows it, and After Dark keeps both drawn styles out
// (tests/after-dark-anime-out.test.ts).
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
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const words = (s: string) => s.split(",").map((w) => w.trim());

describe("the styles", () => {
  it("reads a character's style from their looks, realistic for anything else", () => {
    expect(ART_STYLES).toEqual(["realistic", "anime", "semi_real", "oil_painting", "render_3d", "comic", "ink", "pixel"]);
    expect(ART_STYLE_LABEL).toMatchObject({ realistic: "Realistic", anime: "Anime", semi_real: "2.5D", render_3d: "3D", pixel: "Pixel art" });
    expect(DRAWN_STYLES).toEqual(ART_STYLES.filter((s) => s !== "realistic"));
    expect(artStyleOf({ extras: { looks: { style: "semi_real" } } })).toBe("semi_real");
    expect(artStyleOf({ extras: { looks: { style: "watercolour" } } })).toBe("realistic");
    expect(artStyleOf({ extras: null })).toBe("realistic");
    expect(artStyleFrom(undefined)).toBe("realistic");
    expect(DRAWN_STYLES.every(isDrawnStyle)).toBe(true);
    expect(isDrawnStyle("realistic")).toBe(false);
  });

  it("has one tile per builder style; the newer styles wait for their tiles", () => {
    expect(LOOK_STEPS.find((s) => s.id === "style")!.options.map((o) => o.id)).toEqual([...BUILDER_ART_STYLES]);
  });

  it("asks for an adult in every drawn style, and only picks a newer style from words about a look", () => {
    for (const s of DRAWN_STYLES) {
      expect(STYLE_WORDS[s].finish).toMatch(/clearly grown adult/);
      expect(STYLE_WORDS[s].editFinish).toMatch(/clearly grown adult/);
    }
    expect(artStyleInWords("an oil-painted duchess")).toBe("oil_painting");
    expect(artStyleInWords("a 3D-rendered space pilot")).toBe("render_3d");
    expect(artStyleInWords("drawn in comic-book style")).toBe("comic");
    expect(artStyleInWords("a pen-and-ink detective")).toBe("ink");
    expect(artStyleInWords("a pixel-art knight")).toBe("pixel");
    expect(artStyleInWords("a tattoo ink artist")).toBe("realistic");
    expect(artStyleInWords("a 3D printing hobbyist")).toBe("realistic");
    expect(artStyleInWords("owns a comic book shop")).toBe("realistic");
  });

  it("finds the style a sentence asks for, and the quick start picks it", () => {
    expect(artStyleInWords("A 2.5D painterly barista")).toBe("semi_real");
    expect(artStyleInWords("semi-realistic, like a promo poster")).toBe("semi_real");
    expect(artStyleInWords("an anime swordswoman")).toBe("anime");
    expect(artStyleInWords("a lighthouse keeper who paints")).toBe("realistic");
    expect(suggestLooks({ pronouns: "she/her", words: "a semi-realistic florist with red hair" })?.style).toBe("semi_real");
    expect(suggestLooks({ pronouns: "he/him", words: "a quiet baker" })?.style).toBe("realistic");
  });

  it("asks every drawn picture for a grown adult, and keeps every word a show picture must pass", () => {
    for (const s of DRAWN_STYLES) {
      expect(`${STYLE_WORDS[s].finish} ${STYLE_WORDS[s].short} ${STYLE_WORDS[s].editFinish}`).toMatch(/mature adult/);
      expect(checkPgPictureText({ prompt: `${STYLE_WORDS[s].medium}. ${STYLE_WORDS[s].finish}. ${STYLE_WORDS[s].short} ${STYLE_WORDS[s].editFinish}` }).ok).toBe(true);
    }
    expect(STYLE_WORDS.realistic.editFinish).toBeNull();
  });
});

describe("pictures in 2.5D", () => {
  const ROLE = { role: "a lighthouse keeper", props: "a brass lantern", scene: "a lamp room at dusk" };
  const LOOK = "a broad-shouldered man with a salt-and-pepper beard and kind grey eyes";

  it("draws the recast portrait in the house look, a grown adult said outright, steered off anyone young", () => {
    const p = recastPortraitPrompt(LOOK, 44, ROLE, false, "semi_real");
    expect(p).toMatch(/^Semi-realistic painterly 2\.5D digital illustration, a chest-up character portrait of a broad-shouldered man/);
    expect(p).toContain("They are a lighthouse keeper, with a brass lantern.");
    expect(p).toContain("Soft cinematic rim light, warm key light");
    expect(p).toContain("Clearly a grown adult of 44 with mature adult proportions and an adult face.");
    expect(p).not.toMatch(/anime|photograph/i);
    expect(checkPgPictureText({ prompt: p }).ok).toBe(true);
    // Its negatives: every usual word but "illustration" (it is one), "anime" and "cartoon" kept, and the childlike words.
    for (const w of words(NEGATIVE_PROMPT).filter((w) => w !== "illustration")) expect(words(SEMI_REAL_NEGATIVE_PROMPT)).toContain(w);
    expect(words(SEMI_REAL_NEGATIVE_PROMPT)).not.toContain("illustration");
    expect(words(SEMI_REAL_NEGATIVE_PROMPT)).toEqual(expect.arrayContaining(["childlike face", "chibi", "photograph"]));
    expect(negativePromptFor("semi_real")).toBe(SEMI_REAL_NEGATIVE_PROMPT);
    expect(negativePromptFor("anime")).toBe(ANIME_NEGATIVE_PROMPT);
    expect(negativePromptFor("realistic")).toBeUndefined();
  });

  it("keeps the identity views, PG Studio and the face kit in 2.5D, never a photograph", () => {
    const view = identityViewPrompt("front", { noun: "man", age: 44, look: "a salt-and-pepper beard", style: "semi_real" }, { pg: true });
    expect(view).toMatch(/^Make one 2\.5D illustration of the man from Picture 1, a 44-year-old adult \(a salt-and-pepper beard\): the very same face, features, hair and colours, unchanged\./);
    expect(view).toContain(STYLE_WORDS.semi_real.short);
    expect(view).not.toContain("Photorealistic");

    const plan: PgPlan = { parts: [{ group: "shot", words: "a candid waist-up shot" }], beach: false, custom: null, place: null, ownPlace: null };
    const subject = { noun: "woman" as const, age: 31, look: "short copper hair" };
    expect(pgShootPrompt(plan, subject, true)).toMatch(/^A photograph of the person in the reference picture/);
    expect(pgShootPrompt(plan, subject, true)).toContain(PG_TAIL);
    const anime = pgShootPrompt(plan, { ...subject, style: "anime" }, true);
    expect(anime).toMatch(/^An anime illustration of the person in the reference picture \(a 31-year-old woman, short copper hair\), keeping their face exactly\./);
    expect(anime).toContain(`Fully clothed, tasteful and everyday, safe for work. ${STYLE_WORDS.anime.short} Everyone shown is an adult.`);
    expect(anime).not.toContain("Photorealistic");
    const painted = pgCarouselPrompt({ ...subject, style: "semi_real" }, false, "from a low angle, looking up");
    expect(painted).toMatch(/^A 2\.5D illustration of the person in the reference picture/);
    expect(painted).not.toContain("Photorealistic");
    for (const p of [anime, painted]) expect(checkPgPictureText({ prompt: p }).ok).toBe(true);

    const face = styledFace(FACE_PROMPTS.smile, "semi_real");
    expect(face).toMatch(/^Make one 2\.5D illustration of the character in Picture 1/);
    expect(face).toContain(STYLE_WORDS.semi_real.editFinish!);
    expect(face).not.toContain("Photorealistic");
    expect(styledFace(FACE_LOOP_PROMPT, "semi_real")).toMatch(/^The illustrated character in the picture stays still/);
    expect(styledFace(FACE_LOOP_PROMPT, "anime")).toMatch(/^The anime character in the picture stays still/);
    expect(styledFace(FACE_PORTRAIT_PROMPT, "realistic")).toBe(FACE_PORTRAIT_PROMPT);
    expect(facePromptsPass()).toBe(true);
  });
});

describe("finding characters by style", () => {
  async function character(name: string, style?: string): Promise<string> {
    const id = randomUUID();
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, extras) values ($1, $2, false, $3, 33, 'Repairs clocks.', '["dry"]'::jsonb, 'x', 'x', $4::jsonb)`,
      [id, randomUUID(), name, JSON.stringify(style ? { looks: { style } } : {})],
    );
    return id;
  }

  it("narrows /characters' search to one style", async () => {
    const painted = await character("Ilse Varga", "semi_real");
    const anime = await character("Tsukiha Aoi", "anime");
    const photo = await character("Mara Quill");
    const ids = async (style: "realistic" | "anime" | "semi_real") => (await searchDirectory(t.db, "", 200, { style })).entries.map((e) => e.id);
    // The house cast is drawn in the house look (2.5D) on the show, so the 2.5D search finds them too; their own style
    // stays unset (After Dark's gate), and a person's character is found by its own.
    const twoAndAHalf = await ids("semi_real");
    expect(twoAndAHalf).toContain(painted);
    expect(twoAndAHalf.filter((id) => !id.startsWith("house-"))).toEqual([painted]);
    expect(twoAndAHalf.filter((id) => id.startsWith("house-")).length).toBeGreaterThan(0);
    expect(await ids("anime")).toEqual([anime]);
    const real = await ids("realistic");
    expect(real).toContain(photo);
    expect(real).not.toContain(painted);
    expect(real).not.toContain(anime);
    expect(real.some((id) => id.startsWith("house-"))).toBe(false);
  });
});

describe("over MCP (2.37.0)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
    (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
  async function connect(): Promise<McpContext> {
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-art-style-test" } } }, ctx);
    return { sessionId: ctx.issuedSessionId };
  }
  const looksOf = async (id: string) => (await t.db.query<{ looks: Record<string, unknown> | null }>(`select extras->'looks' as looks from characters where id = $1`, [id])).rows[0].looks;

  it("is the newest version, with its entry", () => {
    expect(MCP_SERVER_INFO.version).toBe("2.38.0");
    expect(MCP_CHANGELOG[0]).toMatchObject({ version: "2.38.0" });
  });

  it("creates a character in a style, changes it without losing the rest of the look, and says it on get_character", async () => {
    const ctx = await connect();
    const made = (await call("create_character", validCharacter({ name: "Odessa Lark", keep_name: true, art_style: "semi_real", extras: { looks: { gender: "woman", hair_color: "red" } } }), ctx)).structuredContent;
    const id = made.character.id as string;
    expect(await looksOf(id)).toMatchObject({ gender: "woman", hair_color: "red", style: "semi_real" });
    expect((await call("get_character", { character_id: id }, ctx)).structuredContent).toMatchObject({ art_style: "semi_real" });

    const changed = await call("update_character", { character_id: id, art_style: "anime" }, ctx);
    expect(changed.isError).toBeFalsy();
    expect(await looksOf(id)).toEqual({ gender: "woman", hair_color: "red", style: "anime" });
    expect((await call("get_character", { character_id: id }, ctx)).structuredContent).toMatchObject({ art_style: "anime" });

    const wrong = await call("update_character", { character_id: id, art_style: "watercolour" }, ctx);
    expect(wrong.isError).toBe(true);
    expect(JSON.stringify(wrong.content)).toMatch(/art_style: one of realistic, anime, semi_real/);
    expect((await looksOf(id))?.style).toBe("anime");
  });

  it("leaves a character made without one realistic, and refuses a wrong one before anything is saved", async () => {
    const ctx = await connect();
    const plain = (await call("create_character", validCharacter({ name: "Rook Marrow", keep_name: true }), ctx)).structuredContent;
    expect((await call("get_character", { character_id: plain.character.id }, ctx)).structuredContent).toMatchObject({ art_style: "realistic" });
    const before = (await t.db.query(`select count(*)::int as n from characters`)).rows[0].n;
    const wrong = await call("create_character", validCharacter({ name: "Pell Ashby", keep_name: true, art_style: "oil" }), ctx);
    expect(wrong.isError).toBe(true);
    expect((await t.db.query(`select count(*)::int as n from characters`)).rows[0].n).toBe(before);
  });
});

/**
 * The show's anime cast (David, 2026-11-08: "add the most popular type of anime characters"): the recast draws a
 * character whose looks say anime in anime, a grown adult said outright; their full-body view stays anime; After Dark's
 * agent cast leaves them out; and Companions can be filtered by how people are drawn.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// The companions browser is a client component that uses the router.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { POST } from "@/app/api/admin/recast/route";
import CompanionBrowser, { matchesStyle } from "@/app/companion/CompanionBrowser";
import { agentCastStatus, checkSheets, setAgentCastModelForTests } from "@/lib/adult/agent-cast";
import { NEGATIVE_PROMPT, setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { COMPANIONS_LISTED, listCompanions, type CompanionListItem } from "@/lib/companion";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { isAnime } from "@/lib/looks";
import type { Model } from "@/lib/model";
import { ANIME_NEGATIVE_PROMPT, recastPortraitPrompt } from "@/lib/recast";
import { checkPgPictureText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { identityViewPrompt } from "@/lib/studio/identity-views";
import { setPgStudioFetchForTests } from "@/lib/studio/pg";
import { api, BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const PW = ["anime", "pw", "tests"].join("-");
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", PW);
  vi.stubEnv("ADULT_MODE", "1");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setMediaFetchForTests(null);
  setModerationFetchForTests(null);
  setPgStudioFetchForTests(null);
  setAgentCastModelForTests(null);
});

const ANIME = { gender: "woman", style: "anime" };
const setLooks = (id: string, looks: Record<string, string>) =>
  t.db.query(`update characters set extras = coalesce(extras, '{}'::jsonb) || jsonb_build_object('looks', $2::jsonb) where id = $1`, [id, JSON.stringify(looks)]);

const ROLE = { role: "a wandering swordswoman", props: "a sheathed katana", scene: "a moonlit shrine gate" };
const LOOK = "a tall woman with long silver hair in a high ponytail and calm violet eyes";

describe("the anime portrait prompt (lib/recast.ts recastPortraitPrompt)", () => {
  it("draws in anime, says twice over that they're a grown adult, and passes the show's PG word check", () => {
    const p = recastPortraitPrompt(LOOK, 27, ROLE, false, true);
    expect(p).toMatch(/^Clean modern anime illustration, a chest-up character portrait of a tall woman/);
    expect(p).toContain("They are a wandering swordswoman, with a sheathed katana.");
    expect(p).toContain("Behind them, a moonlit shrine gate.");
    expect(p).toContain("Clearly a grown adult of 27 with mature adult proportions and an adult face.");
    expect(p).not.toMatch(/photograph|photoreal/i);
    expect(p).not.toContain("unmistakable");
    expect(checkPgPictureText({ prompt: p }).ok).toBe(true);
  });

  it("is never drawn younger than 21, pushes the role on the second try, and needs no role", () => {
    expect(recastPortraitPrompt(LOOK, 19, ROLE, false, true)).toContain("a grown adult of 21 ");
    expect(recastPortraitPrompt(LOOK, 27, ROLE, true, true)).toContain("It must be unmistakable at a glance that they are a wandering swordswoman: a sheathed katana prominent");
    const plain = recastPortraitPrompt(LOOK, 30, null, false, true);
    expect(plain).toContain("A soft painted background.");
    expect(plain).not.toContain("They are");
    expect(checkPgPictureText({ prompt: plain }).ok).toBe(true);
  });

  it("leaves everyone else's photograph as it was", () => {
    expect(recastPortraitPrompt(LOOK, 30, ROLE)).toMatch(/^Warm, natural editorial portrait photograph/);
    expect(recastPortraitPrompt(LOOK, 30, ROLE)).not.toContain("anime");
  });

  it("is steered away from anyone young-looking as hard as any picture, without the usual 'no anime'", () => {
    const words = (s: string) => s.split(",").map((w) => w.trim());
    for (const w of words(NEGATIVE_PROMPT).filter((w) => !["cartoon", "anime", "illustration"].includes(w))) expect(words(ANIME_NEGATIVE_PROMPT)).toContain(w);
    expect(words(ANIME_NEGATIVE_PROMPT)).toEqual(expect.arrayContaining(["teen", "young-looking", "school uniform", "childlike face", "childlike body", "chibi", "photograph"]));
    expect(words(ANIME_NEGATIVE_PROMPT)).not.toContain("anime");
    expect(words(ANIME_NEGATIVE_PROMPT)).not.toContain("cartoon");
    expect(words(ANIME_NEGATIVE_PROMPT)).not.toContain("illustration");
  });

  it("knows an anime character by their looks", () => {
    expect(isAnime({ extras: { looks: { style: "anime" } } })).toBe(true);
    expect(isAnime({ extras: { looks: { style: "realistic" } } })).toBe(false);
    expect(isAnime({ extras: {} })).toBe(false);
    expect(isAnime(null)).toBe(false);
  });
});

describe("an anime character's views (lib/studio/identity-views.ts)", () => {
  it("stay anime, not photographs of them, and still say adult", () => {
    const p = identityViewPrompt("full_body", { noun: "woman", age: 26, look: "long silver hair", anime: true }, { pg: true, outfit: "a dark kimono-style coat" });
    expect(p).toMatch(/^Make one anime illustration of the woman from Picture 1, a 26-year-old adult \(long silver hair\): the very same face, features, hair and colours, unchanged\./);
    expect(p).toContain("Clean modern anime illustration, cel shading, mature adult proportions. Everyone shown is an adult.");
    expect(p).not.toContain("Photorealistic");
    expect(checkPgPictureText({ prompt: p }).ok).toBe(true);
    // Everyone else's are photographs, as before.
    const photo = identityViewPrompt("full_body", { noun: "woman", age: 26, look: "long silver hair" }, { pg: true });
    expect(photo).toMatch(/^Make one photograph of the woman from Picture 1/);
    expect(photo).toContain("skin tone, unchanged.");
    expect(photo).toContain("Fully clothed, tasteful and everyday, safe for work. Photorealistic. Everyone shown is an adult.");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The recast route draws them that way (the fakes as tests/admin-recast.test.ts has them).

const call = (body: unknown) =>
  POST(new Request(`${BASE_URL}/api/admin/recast`, { method: "POST", headers: { "content-type": "application/json", "x-frontier-key": PW }, body: JSON.stringify(body) }));

async function agentCharacter(name: string) {
  const cookie = newUserCookie();
  const id = (await (await api.createCharacter(validCharacter({ name }), cookie)).json()).id as string;
  await t.db.query(`update characters set created_via = 'mcp' where id = $1`, [id]);
  return { id, owner: userIdOf(cookie) };
}

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The negative prompts sent with each new picture (not an edit), in order. */
const negatives: string[] = [];
/** The prompts the image models were asked, in order; every check passes (an adult, clothed, reads as the role). */
function fakes(): string[] {
  const asked: string[] = [];
  negatives.length = 0;
  setMediaFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body ?? "{}"));
    asked.push(String(sent.prompt ?? ""));
    negatives.push(String(sent.negative_prompt ?? ""));
    return Response.json({ images: [PNG.toString("base64")] });
  });
  setPgStudioFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    asked.push(String(JSON.parse(String(init?.body ?? "{}")).prompt ?? ""));
    return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
  });
  setModerationFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    const content = body.includes("role_check") ? { answer: "YES" } : body.includes("pg_check") ? { answer: "SAFE" } : { clothing: "CLOTHED", age: "ADULTS" };
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  });
  return asked;
}

describe("the recast of an anime character (POST /api/admin/recast)", () => {
  it("draws their portrait and their full body in anime", async () => {
    const a = await agentCharacter("Sayo Kirishima");
    await setLooks(a.id, ANIME);
    const asked = fakes();
    expect(await (await call({ action: "portrait", character_id: a.id, look: LOOK, ...ROLE })).json()).toMatchObject({ ok: true, role_ok: true, tries: 1 });
    expect(asked[0]).toMatch(/^Clean modern anime illustration/);
    expect(asked[0]).toContain("a grown adult of");
    expect(negatives[0]).toBe(ANIME_NEGATIVE_PROMPT);
    expect(await (await call({ action: "body", character_id: a.id, outfit: "a dark kimono-style coat and boots", ...ROLE })).json()).toMatchObject({ ok: true, made: 1 });
    expect(asked[1]).toMatch(/^Make one anime illustration of the/);
    expect(asked[1]).not.toContain("Photorealistic");
  });

  it("still draws a realistic character as a photograph", async () => {
    const a = await agentCharacter("Mara Quell");
    await setLooks(a.id, { gender: "woman", style: "realistic" });
    const asked = fakes();
    await call({ action: "portrait", character_id: a.id, look: LOOK, ...ROLE });
    expect(asked[0]).toMatch(/^Warm, natural editorial portrait photograph/);
    expect(negatives[0]).toBe(NEGATIVE_PROMPT);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// After Dark never draws anime, so its agent cast leaves the anime cast out.

async function ourAgent(): Promise<string> {
  const id = crypto.randomUUID();
  await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return id;
}
async function character(owner: string, name: string, opts: { via?: "mcp" | "web"; companion?: boolean } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, visibility, companion_open)
     values ($1, $2, false, $3, 29, 'Keeps a small shrine by the river.', '["calm","dry"]'::jsonb, 'Someone steady', 'Cruelty', $4, 'public', $5)`,
    [id, owner, name, opts.via ?? "mcp", opts.companion ?? false],
  );
  return id;
}

describe("After Dark's agent cast (lib/adult/agent-cast.ts)", () => {
  it("never counts or checks an anime character", async () => {
    const owner = await ourAgent();
    await character(owner, "Rook Marrow");
    const anime = await character(owner, "Sayo Kirishima");
    await setLooks(anime, ANIME);
    expect((await agentCastStatus(t.db)).ours).toBe(1);
    const asked: string[] = [];
    setAgentCastModelForTests({
      async complete(messages: { content: string }[]) {
        asked.push(JSON.parse(messages[messages.length - 1].content).name);
        return JSON.stringify({ adult: true, humanoid: true, real_person: false, fits: true, reason: "A grown-up." });
      },
    } as unknown as Model);
    expect(await checkSheets(t.db)).toMatchObject({ checked: 1, passed: 1 });
    expect(asked).toEqual(["Rook Marrow"]);
    expect((await t.db.query(`select 1 from adult_cast_checks where character_id = $1`, [anime])).rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Companions: how each one is drawn, a Style filter once anyone's anime, and room for everyone.

describe("the companions list (lib/companion.ts listCompanions)", () => {
  it("says how each one is drawn", async () => {
    const owner = crypto.randomUUID();
    const anime = await character(owner, "Sayo Kirishima", { companion: true });
    await setLooks(anime, ANIME);
    const real = await character(owner, "Rook Marrow", { companion: true });
    const { cast } = await listCompanions(t.db, "a-viewer");
    expect(cast.find((c) => c.id === anime)?.style).toBe("anime");
    expect(cast.find((c) => c.id === real)?.style).toBe("realistic");
    expect(cast.filter((c) => c.house).every((c) => c.style === "realistic")).toBe(true);
  });

  it(`lists up to ${COMPANIONS_LISTED}, past the old 200`, async () => {
    expect(COMPANIONS_LISTED).toBeGreaterThanOrEqual(400);
    const owner = crypto.randomUUID();
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, visibility, companion_open)
       select 'many-' || g, $1, false, 'Person ' || lpad(g::text, 3, '0'), 30, 'Restores old radios.', '["dry"]'::jsonb, 'Someone kind', 'Cruelty', 'mcp', 'public', true
         from generate_series(1, 210) g`,
      [owner],
    );
    const { cast } = await listCompanions(t.db, "a-viewer");
    expect(cast.filter((c) => c.id.startsWith("many-"))).toHaveLength(210);
  });
});

const companion = (i: number, style: CompanionListItem["style"] = "realistic"): CompanionListItem => ({
  id: `c${i}`,
  name: `Person ${String(i).padStart(2, "0")}`,
  bio: "Restores old radios.",
  portrait: null,
  hue: null,
  house: false,
  yours: false,
  pronouns: null,
  thread_id: null,
  last: null,
  last_at: null,
  age: 30,
  traits: ["dry"],
  source: "agent",
  on_show: false,
  created_at: "2026-11-01T00:00:00.000Z",
  style,
});
const html = (props: Parameters<typeof CompanionBrowser>[0]) => renderToStaticMarkup(createElement(CompanionBrowser, props));
const tiles = (markup: string) => markup.match(/<li class="companion-tile"/g)?.length ?? 0;

describe("the companions browser's Style filter (app/companion/CompanionBrowser.tsx)", () => {
  it("shows only once someone listed is drawn in anime", () => {
    const realOnly = html({ threads: [], others: [companion(1), companion(2)] });
    expect(realOnly).not.toContain('<span class="sr-only">Style</span>');
    const mixed = html({ threads: [], others: [companion(1), companion(2, "anime")] });
    expect(mixed).toContain('<span class="sr-only">Style</span>');
    expect(mixed).toContain('<option value="any" selected="">Any style</option><option value="realistic">Realistic</option><option value="anime">Anime</option>');
  });

  it("filters by ?style=, and keeps the filter showing when nobody matches", () => {
    const others = [companion(1), companion(2, "anime"), companion(3, "anime")];
    expect(tiles(html({ threads: [], others }))).toBe(3);
    expect(tiles(html({ threads: [], others, initial: { style: "anime" } }))).toBe(2);
    expect(tiles(html({ threads: [], others, initial: { style: "realistic" } }))).toBe(1);
    // An unknown style is no filter at all.
    expect(tiles(html({ threads: [], others, initial: { style: "watercolour" } }))).toBe(3);
    const none = html({ threads: [], others: [companion(1)], initial: { style: "anime" } });
    expect(tiles(none)).toBe(0);
    expect(none).toContain('<span class="sr-only">Style</span>');
    expect(matchesStyle(companion(1), "any")).toBe(true);
    expect(matchesStyle(companion(1), "anime")).toBe(false);
  });
});

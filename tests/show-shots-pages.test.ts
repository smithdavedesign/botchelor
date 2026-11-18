import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The pages read the viewer from next/headers: hand them this cookie store (as tests/character-verb.test.ts does).
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
vi.mock("@/app/AfterDarkTeaser", () => ({ default: () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import CharacterPage from "@/app/characters/[id]/page";
import EpisodePage from "@/app/episodes/[id]/page";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { characterPortrait } from "@/lib/portraits";
import type { Shot } from "@/lib/show-shots-shared";
import { HOUSE_PARTNER_ID, setupEpisode, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// Where the show kit's shots show (lib/show-shots.ts, PRD styles-and-storylines phase 3): a character's "On the show"
// strip, and each confessional line beside its confessional shot. The chat and theater faces are tests/show-shots.test.ts.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=").slice(1).join("="));
};
const profile = async (id: string, cookie: string | null = null) => {
  as(cookie);
  return renderToStaticMarkup(await CharacterPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
};
const episodePage = async (id: string, cookie: string | null) => {
  as(cookie);
  return renderToStaticMarkup(await EpisodePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
};
/** Ready shots of a house character, drawn from their portrait file in the house look (2.5D, the show's style for them). */
async function readyShots(characterId: string, shots: readonly Shot[]) {
  for (const s of shots) {
    await t.db.query(`insert into show_shots (id, character_id, portrait_key, style, shot, status, model) values ($1, $2, $3, 'semi_real', $4, 'ready', 'm')`, [
      `${s}-${characterId}`,
      characterId,
      `static:${characterPortrait(characterId)}`,
      s,
    ]);
  }
}

describe("the show kit on the pages", () => {
  it("gives a character's page an \"On the show\" strip, the moments before the faces and the reveal shown whole", async () => {
    const id = HOUSE_CHARACTERS[0].id;
    expect(await profile(id)).not.toContain("On the show");
    await readyShots(id, ["smitten", "reveal", "rose"]);
    const html = await profile(id);
    const strip = html.slice(html.indexOf('id="show-kit-title"'), html.indexOf("</section>", html.indexOf('id="show-kit-title"')));
    expect(strip).toContain(">On the show</h2>");
    expect(strip).toContain(`<li class="is-reveal"><img src="/api/shots/reveal-${id}.webp"`);
    expect(strip.indexOf("The reveal")).toBeLessThan(strip.indexOf("The rose"));
    expect(strip.indexOf("The rose")).toBeLessThan(strip.indexOf("Smitten"));
    // Only what's drawn: no empty tiles for the rest.
    expect(strip).not.toContain("Laughing");
    expect(strip).not.toContain("The confessional");
  });

  it("puts each confessional line beside its confessional shot, and keeps the small face for one without", async () => {
    const { creator, episode } = await setupEpisode();
    await readyShots(HOUSE_PARTNER_ID, ["confessional"]);
    const html = await episodePage(episode.id, creator);
    expect(html).toContain("The confessionals");
    expect(html).toContain(`<img class="confessional-shot" src="/api/shots/confessional-${HOUSE_PARTNER_ID}.webp"`);
    expect(html.match(/class="confessional-shot"/g)).toHaveLength(1);
    expect(html.match(/class="confessional-with-shot"/g)).toHaveLength(1);
  });
});

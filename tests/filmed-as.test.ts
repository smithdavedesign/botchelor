import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The pages read the viewer from next/headers: hand them this cookie store (as tests/show-shots-pages.test.ts does).
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
import { POST as recast } from "@/app/api/admin/recast/route";
import EpisodePage from "@/app/episodes/[id]/page";
import { changesFilmedName, filmedAs, filmedAsLine } from "@/lib/filmed-as";
import { getEpisodeView } from "@/lib/game";
import { api, BASE_URL, newUserCookie, setupEpisode, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// 2026-11-22 audit: characters renamed after their dates (the 2026-11-02 recast) showed the new name over lines that
// still said the old one, with the old pronouns. The page now says who they were when it was filmed, and the recast
// keeps the first name and pronouns of a character with dates.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const PW = ["filmed", "as", "tests"].join("-");
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", PW);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const episodePage = async (id: string, cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=").slice(1).join("="));
  return renderToStaticMarkup(await EpisodePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
};
const flat = (html: string) => html.replace(/&#x27;/g, "'");

describe("who they were when it was filmed (lib/filmed-as.ts)", () => {
  it("names the old name, and the old pronouns only when those changed", () => {
    expect(filmedAs({ name: "Vesper Lark", pronouns: "she/her" }, { name: "Thorne Bracken", pronouns: "he/him" })).toEqual({ name: "Vesper Lark", pronouns: "she/her" });
    expect(filmedAs({ name: "Vesper Lark", pronouns: "she/her" }, { name: "Thorne Bracken", pronouns: "she/her" })).toEqual({ name: "Vesper Lark", pronouns: null });
    expect(filmedAs({ name: "Vesper Lark", pronouns: "she/her" }, { name: "Vesper Lark", pronouns: "they/them" })).toEqual({ name: "Vesper Lark", pronouns: "she/her" });
    // Nothing a viewer would notice, or no kept sheet: nothing to say.
    expect(filmedAs({ name: "vesper lark ", pronouns: "she/her" }, { name: "Vesper Lark", pronouns: "she/her" })).toBeNull();
    expect(filmedAs({ name: "Vesper Lark" }, { name: "Vesper Lark", pronouns: "he/him" })).toBeNull();
    expect(filmedAs(undefined, { name: "Thorne Bracken" })).toBeNull();
  });

  it("says it in a line", () => {
    expect(filmedAsLine("Thorne Bracken", { name: "Vesper Lark", pronouns: "she/her" })).toBe("Thorne Bracken was called Vesper Lark (she/her) when this date was filmed.");
    expect(filmedAsLine("Thorne Bracken", { name: "Vesper Lark", pronouns: null })).toBe("Thorne Bracken was called Vesper Lark when this date was filmed.");
    expect(filmedAsLine("Vesper Lark", { name: "Vesper Lark", pronouns: "she/her" })).toBe("Vesper Lark went by she/her when this date was filmed.");
  });

  it("an edit changes what the dates call them when the first name or the pronouns change", () => {
    const now = { name: "Vesper Lark", pronouns: "she/her" };
    expect(changesFilmedName(now, { name: "Thorne Bracken" })).toBe(true);
    expect(changesFilmedName(now, { pronouns: "he/him" })).toBe(true);
    expect(changesFilmedName(now, { name: "Vesper Okafor" })).toBe(false);
    expect(changesFilmedName(now, { name: "Vesper Lark", pronouns: "she/her", bio: "New." } as never)).toBe(false);
    expect(changesFilmedName(now, { bio: "New." } as never)).toBe(false);
  });
});

describe("a date's page after its character was renamed", () => {
  it("says the old name and pronouns under the title, to whoever reads the lines", async () => {
    const { creator, character, episode } = await setupEpisode();
    await t.db.query(`update characters set pronouns = 'she/her' where id = $1`, [character.id]);
    // The sheet the date kept, as a date booked with her pronouns set keeps it.
    await t.db.query(`update episodes set status = 'ready', visibility = 'public', revealed_at = now(), setup = jsonb_set(setup, '{sheet_a,pronouns}', '"she/her"') where id = $1`, [episode.id]);
    const setup = (await t.db.query<{ setup: { sheet_a?: { name: string } } }>(`select setup from episodes where id = $1`, [episode.id])).rows[0].setup;
    expect(setup.sheet_a?.name).toBe(character.name);
    // Untouched: nothing to say.
    expect((await getEpisodeView(t.db, episode.id, null))!.characters[0].filmed_as).toBeUndefined();
    expect(flat(await episodePage(episode.id, null))).not.toContain("data-filmed-as");

    await t.db.query(`update characters set name = 'Thorne Bracken', pronouns = 'he/him' where id = $1`, [character.id]);
    const view = (await getEpisodeView(t.db, episode.id, null))!;
    expect(view.characters[0].name).toBe("Thorne Bracken");
    expect(view.characters[0].filmed_as).toEqual({ name: character.name, pronouns: "she/her" });
    expect(view.characters[1].filmed_as).toBeUndefined();

    for (const viewer of [null, creator]) {
      const html = flat(await episodePage(episode.id, viewer));
      expect(html).toContain(`data-filmed-as="${character.id}"`);
      expect(html).toContain(`Thorne Bracken was called ${character.name} (she/her) when this date was filmed.`);
    }
  });

  it("says nothing to a viewer who can't read the lines yet", async () => {
    const { character, episode } = await setupEpisode();
    await t.db.query(`update characters set name = 'Thorne Bracken' where id = $1`, [character.id]);
    await t.db.query(`update episodes set revealed_at = null where id = $1`, [episode.id]);
    const view = (await getEpisodeView(t.db, episode.id, null))!;
    expect(view.revealed).toBe(false);
    expect(view.characters[0].filmed_as).toBeUndefined();
  });
});

describe("the recast keeps the name of a character with dates", () => {
  const call = (body: unknown) =>
    recast(new Request(`${BASE_URL}/api/admin/recast`, { method: "POST", headers: { "content-type": "application/json", "x-frontier-key": PW }, body: JSON.stringify(body) }));

  it("refuses a new first name or pronouns once it has a date; a surname or anything else still changes", async () => {
    const { character } = await setupEpisode();
    await t.db.query(`update characters set created_via = 'mcp' where id = $1`, [character.id]);

    const renamed = await call({ action: "update", character_id: character.id, patch: { name: "Thorne Bracken", bio: "A lighthouse keeper." } });
    expect(renamed.status).toBe(409);
    const body = await renamed.json();
    expect(body.error).toBe("has_dates");
    expect(body.message).toMatch(/has 1 date whose lines call them/);
    expect((await call({ action: "update", character_id: character.id, patch: { pronouns: "they/them" } })).status).toBe(409);
    expect((await t.db.query<{ name: string }>(`select name from characters where id = $1`, [character.id])).rows[0].name).toBe(character.name);

    const first = character.name.split(" ")[0];
    const kept = await call({ action: "update", character_id: character.id, patch: { name: `${first} Okafor`, bio: "A lighthouse keeper who repairs radios." } });
    expect(kept.status).toBe(200);
    expect((await t.db.query<{ name: string }>(`select name from characters where id = $1`, [character.id])).rows[0].name).toBe(`${first} Okafor`);
  });

  it("renames one with no dates yet, as before", async () => {
    const id = (await (await api.createCharacter(validCharacter({ name: "Rook Marrow" }), newUserCookie())).json()).id as string;
    await t.db.query(`update characters set created_via = 'mcp' where id = $1`, [id]);
    const res = await call({ action: "update", character_id: id, patch: { name: "Captain Isolde Brack", pronouns: "she/her" } });
    expect(res.status).toBe(200);
  });
});

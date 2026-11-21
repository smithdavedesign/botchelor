import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The page reads nothing of the viewer (the public world only); the site chrome it renders asks next/headers.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
import { renderToStaticMarkup } from "react-dom/server";
import WorldPage, { generateMetadata } from "@/app/graph/world/[id]/page";
import { setDbForTests } from "@/lib/db";
import { DELETED_OWNER } from "@/lib/rules";
import { addPerson } from "@/lib/social/people";
import { ensurePlace, setMembership } from "@/lib/social/places";
import { upsertTie } from "@/lib/social/ties";
import type { TieInput } from "@/lib/social/types";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// "X's world" (/graph/world/[id], docs/PRDs/social-network.md section 9): one character amid everyone they're tied to,
// drawn on the server, with the list under it; the public record only, private characters as the sky shows them.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
  setDbForTests(null);
});
beforeEach(async () => {
  await t.reset();
  setDbForTests(t.db);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ID = (k: string) => `wp-${k}`;
const [ADA, BEA, CAL, DEE, ZED] = ["ada", "bea", "cal", "dee", "zed"].map(ID);
const owner = userIdOf(newUserCookie());

async function character(k: string, o: { visibility?: string; owner?: string } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, avatar_hue, extras)
     values ($1, $2, false, $3, 30, 'Keeps bees and opinions.', '["kind"]'::jsonb, 'someone kind', 'liars', $4, 120, '{}'::jsonb)`,
    [ID(k), o.owner ?? owner, `World ${k[0].toUpperCase()}${k.slice(1)}`, o.visibility ?? "public"],
  );
}
const tie = async (input: TieInput) => {
  const w = await upsertTie(t.db, input);
  if (!w.ok) throw new Error(`tie refused: ${w.reason}`);
};
const page = async (id: string) => renderToStaticMarkup(await WorldPage({ params: Promise.resolve({ id }) }));
const meta = (id: string) => generateMetadata({ params: Promise.resolve({ id }) });

async function seed() {
  for (const k of ["ada", "bea", "cal", "dee"]) await character(k);
  await character("zed", { visibility: "private" });
  await tie({ from: ADA, to: BEA, kind: "best_friend", source: "owner" });
  await tie({ from: ADA, to: CAL, kind: "feud", source: "derived", evidence: [{ ref: "scene:wp-scene-1", at: "2026-11-18T20:00:00Z" }] });
  await tie({ from: ADA, to: DEE, kind: "coworker", source: "owner" });
  await tie({ from: ADA, to: ZED, kind: "friend", source: "owner" });
  const place = (await ensurePlace(t.db, { key: "wp-dive", kind: "venue", name: "the dive bar", source: "admin" })).id;
  for (const id of [ADA, BEA]) await setMembership(t.db, { placeId: place, characterId: id, role: "regular", source: "admin" });
}

describe("X's world", () => {
  it("draws them amid their rings, whoever they're at odds with on the red arc, each face linked to its world", async () => {
    await seed();
    const html = await page(ADA);
    expect(html).toContain("World Ada&#x27;s world");
    // The picture: rings, the faces' links, a line to each one's row, the red arc, the place round the edge.
    expect(html).toContain('class="world-sky"');
    expect(html).toContain(`href="/graph/world/${BEA}"`);
    expect(html).toContain(`href="#with-${CAL}"`);
    expect(html).toContain('class="world-odds"');
    expect(html).toContain("Regular at the dive bar");
    // The list: a row a person, what made it linked (the feud's scene).
    expect(html).toContain(`id="with-${BEA}"`);
    expect(html).toContain("best friend");
    expect(html).toContain(`href="/house?scene=wp-scene-1#scene-wp-scene-1"`);
    // A private character they're tied to: its name and that they're tied, nothing more.
    expect(html).toMatch(/🔒 World Zed/);
    expect(html).not.toMatch(/World Zed[^<]*<\/[^>]+>[^<]*friend/);
  });

  it("shares and indexes as a page of its own, and a thin world says noindex", async () => {
    await seed();
    const m = await meta(ADA);
    expect(m.title).toBe("World Ada's world");
    expect(m.alternates?.canonical).toBe(`/graph/world/${ADA}`);
    // Four ties: not thin, but a character page nobody's indexing yet (no aired date, not this season's cast) keeps it out.
    expect(m.robots).toEqual({ index: false, follow: true });
    const thin = await meta(DEE);
    expect(thin.robots).toEqual({ index: false, follow: true });
  });

  it("a private character's world is its name and that its ties exist", async () => {
    await seed();
    const html = await page(ZED);
    expect(html).toContain("Private: their creator keeps them to themselves");
    expect(html).not.toContain("best friend");
    expect((await meta(ZED)).robots).toEqual({ index: false, follow: true });
  });

  it("off-screen people are grey dots with their names", async () => {
    await seed();
    const person = await addPerson(t.db, { holderId: ADA, name: "Aunt Moira", source: "owner", visibility: "public" });
    if (!person.ok) throw new Error(person.reason);
    await tie({ from: ADA, toPerson: person.person.id, kind: "aunt_uncle", source: "owner" });
    const html = await page(ADA);
    expect(html).toContain("Aunt Moira");
    expect(html).toContain("Off the show");
  });

  it("is a 404 for nobody, a deleted account's character, and with the views off", async () => {
    await seed();
    await expect(page("wp-nobody")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(page("../etc")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await t.db.query(`update characters set owner_id = $2 where id = $1`, [DEE, DELETED_OWNER]);
    await expect(page(DEE)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    vi.stubEnv("SOCIAL_LENSES", "0");
    await expect(page(ADA)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
});

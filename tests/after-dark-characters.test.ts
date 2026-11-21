// After Dark's Characters (lib/adult/character-list.ts, app/after-dark/characters; docs/after-dark.md "Characters"): the
// grid lists exactly who After Dark lets this viewer have a night with (eligibleIds: this season's cast, the agent cast,
// their own switched In), a page each; never another person's private character, never one switched In by someone else,
// never their own that's Out, never a house character off this season's cast. Not found for anyone the viewer may not
// see; the locked preview for someone After Dark isn't open to; the header's door.
import { randomUUID } from "node:crypto";
import { createElement, type ReactElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), path: "/after-dark/characters" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => jar.path,
  useSearchParams: () => new URLSearchParams(),
}));
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import AfterDarkCharacterPage from "@/app/after-dark/characters/[id]/page";
import AfterDarkCharactersPage from "@/app/after-dark/characters/page";
import AfterDarkHome from "@/app/after-dark/page";
import Nav, { adLinks } from "@/app/Nav";
import { claimAdmin } from "@/lib/admins";
import { ADULT_COOKIE } from "@/lib/age";
import { adCast, bioLine, CHARACTERS_PAGE, charactersHref, filterCast, nightsWith, parseCharacterFilter, tagChips, type AdCharacter } from "@/lib/adult/character-list";
import { ownMedia } from "@/lib/adult/media";
import { pairPath } from "@/lib/adult/pair-pick";
import { PREVIEW_SOURCE, PREVIEW_TILES } from "@/lib/adult/preview";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setPlaceForTests } from "@/lib/place";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

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
  jar.path = "/after-dark/characters";
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setPlaceForTests({ country: "US", region: "CA" });
  // OFF: a season newcomer outside the house roster (as Barnaby is), off this season's cast: since 2026-11-21 every
  // roster house character is always in After Dark, so a newcomer is the only house character who can be out.
  await t.db.query(`create temp table newcomer as select * from characters where id = $1`, [A.id]);
  await t.db.query(`update newcomer set id = $1, name = $2`, [OFF.id, OFF.name]);
  await t.db.query(`insert into characters select * from newcomer`);
  await t.db.query(`drop table newcomer`);
  setSeasonCastForTests([A.id, B.id]);
});
afterEach(() => {
  setSeasonCastForTests(null);
  vi.unstubAllEnvs();
});

/** Two of the house cast on this season's cast; every roster house character is in too; OFF, a newcomer, kept off it. */
const [A, B] = HOUSE_CHARACTERS.slice(0, 2);
const OFF = { id: "house-newt", name: "Newt Okafor" };
const HOUSE = HOUSE_CHARACTERS.map((c) => c.id);
const first = (n: string) => n.split(/\s+/)[0];

const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
/** What a page that stops threw (a not-found or a redirect), or "rendered". */
const digest = async (p: Promise<unknown>) => {
  try {
    await p;
    return "rendered";
  } catch (e) {
    return String((e as { digest?: string }).digest ?? e);
  }
};
const grid = async (sp: Record<string, string> = {}) => html(await AfterDarkCharactersPage({ searchParams: Promise.resolve(sp) }));
const profile = async (id: string) => html(await AfterDarkCharacterPage({ params: Promise.resolve({ id }) }));
/** The ids of the cards on a grid page, in order. */
const cards = (page: string) => [...page.matchAll(/data-character="([^"]+)"/g)].map((m) => m[1]);

function signIn(id: string) {
  const c = signedInCookie(id);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
}
async function admin(): Promise<string> {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  signIn(id);
  return id;
}
async function subscriber(): Promise<string> {
  const id = randomUUID();
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  signIn(id);
  return id;
}
async function character(owner: string, name: string, opts: { visibility?: string; open?: boolean; bio?: string } = {}): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, after_dark_open)
     values ($1, $2, false, $3, 31, $4, '["dry"]'::jsonb, 'x', 'x', $5, $6)`,
    [id, owner, name, opts.bio ?? "Restores clocks in a shop that smells of oil.", opts.visibility ?? "public", opts.open ?? false],
  );
  return id;
}
const switchIn = (owner: string, id: string) => t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, id]);
async function night(owner: string, x: string, y: string, lines = 2): Promise<void> {
  const [a, b] = [x, y].sort();
  const said = Array.from({ length: lines }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `*smiles* Line ${i + 1} by the harbour.` }));
  await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, lines) values ($1, $2, $3, $4, $5::jsonb)`, [randomUUID(), owner, a, b, JSON.stringify(said)]);
}
async function picture(owner: string, x: string, opts: { b?: string | null; kind?: string } = {}): Promise<string> {
  const id = randomUUID();
  await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, $5, 'x', 'image/png', '\\x00', 'ready')`, [
    id,
    owner,
    x,
    opts.b ?? null,
    opts.kind ?? "scene",
  ]);
  return id;
}

/** Everyone a test sets up: whose they are and whether they're switched In or open to After Dark. */
async function world() {
  const me = await admin();
  const other = randomUUID();
  const mineIn = await character(me, "Ines Valdecasas-Rook");
  await switchIn(me, mineIn);
  const mineOut = await character(me, "Odile Out-of-it");
  const minePrivate = await character(me, "Pia Private-Mine", { visibility: "private" });
  await switchIn(me, minePrivate);
  // Another person's: private and switched In by them; public and switched In by them; their agent-cast one (open).
  const theirsPrivate = await character(other, "Quill Secret", { visibility: "private" });
  await switchIn(other, theirsPrivate);
  const theirsIn = await character(other, "Rosalind Theirs");
  await switchIn(other, theirsIn);
  const agent = await character(other, "Sable Agentcast", { open: true });
  // Private can't be open (lib/adult/agent-cast.ts never opens one), but even a stray flag lists nobody's private character.
  const theirsPrivateOpen = await character(other, "Tamsin Stray-Flag", { visibility: "private", open: true });
  return { me, other, mineIn, mineOut, minePrivate, theirsPrivate, theirsIn, agent, theirsPrivateOpen };
}

describe("who's listed", () => {
  it("exactly who After Dark lets them pair: the house cast, the agent cast and their own switched In (a private one of theirs too)", async () => {
    const w = await world();
    const listed = new Set((await adCast(t.db, w.me)).map((c) => c.id));
    expect(listed).toEqual(new Set([...HOUSE, w.agent, w.mineIn, w.minePrivate]));
    const page = await grid();
    expect(new Set(cards(page))).toEqual(listed);
    expect(page).toContain(`${HOUSE.length + 3} characters`);
  });

  it("never another person's private character, one switched In by someone else, their own that's Out, or a house character off the cast", async () => {
    const w = await world();
    const page = await grid();
    for (const [id, name] of [
      [w.theirsPrivate, "Quill Secret"],
      [w.theirsPrivateOpen, "Tamsin Stray-Flag"],
      [w.theirsIn, "Rosalind Theirs"],
      [w.mineOut, "Odile Out-of-it"],
      [OFF.id, OFF.name],
    ]) {
      expect(page, name).not.toContain(id);
      expect(page, name).not.toContain(name);
    }
    // And for the other person, nobody of the first one's: their own switched-in private one is theirs alone.
    signIn(w.other);
    await claimAdmin(t.db, w.other);
    const theirs = await grid();
    expect(theirs).not.toContain(w.minePrivate);
    expect(theirs).not.toContain(w.mineIn);
    expect(new Set(cards(theirs))).toEqual(new Set([...HOUSE, w.agent, w.theirsPrivate, w.theirsIn]));
  });

  it("a subscriber sees the same rule as an admin", async () => {
    const me = await subscriber();
    const mine = await character(me, "Ula Subscriber");
    await switchIn(me, mine);
    expect(new Set(cards(await grid()))).toEqual(new Set([...HOUSE, mine]));
  });
});

describe("a card", () => {
  it("has the face, the name, up to two type tags, a line of bio, and their nights and pictures with this viewer", async () => {
    const w = await world();
    await t.db.query(`insert into character_tags (character_id, tag, source) values ($1, 'sunshine', 'owner'), ($1, 'rebel', 'owner'), ($1, 'grump', 'owner')`, [w.mineIn]);
    await night(w.me, w.mineIn, A.id);
    await night(w.me, w.mineIn, w.minePrivate);
    await night(w.me, w.mineIn, B.id, 0); // not under way: no lines
    await picture(w.me, w.mineIn, { b: A.id });
    await picture(w.me, A.id, { b: w.mineIn });
    await picture(w.me, w.mineIn, { kind: "baseline" }); // a face, not a picture
    await picture(w.other, w.mineIn); // someone else's
    const face = await picture(w.me, w.mineIn, { kind: "baseline" });
    await t.db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, $2, $3)`, [w.me, w.mineIn, face]);
    const page = await grid();
    const card = page.slice(page.indexOf(`data-character="${w.mineIn}"`), page.indexOf("</li>", page.indexOf(`data-character="${w.mineIn}"`)));
    expect(card).toContain(`href="/after-dark/characters/${w.mineIn}"`);
    expect(card).toContain("Ines Valdecasas-Rook");
    expect(card).toContain("Restores clocks in a shop that smells of oil.");
    expect(card).toContain("2 nights · 2 pictures");
    expect((card.match(/ad-char-tags">([^<]*)</) ?? [])[1]?.split(" · ")).toHaveLength(2);
    expect(card).toContain("Yours");
    // Their After Dark face, a plain picture (so the discreet blur keeps the card's corners, not a portrait's circle).
    const img = card.match(/<img[^>]*>/)?.[0] ?? "";
    expect(img).toContain(`/api/admin/after-dark/media/${face}?w=640`);
    expect(img).not.toContain("avatar");
    // Theirs under way first.
    expect(cards(page)[0]).toBe(w.mineIn);
    // Without a face of theirs: the show's PG portrait (.avatar: the blur leaves it alone).
    const plain = page.slice(page.indexOf(`data-character="${w.agent}"`));
    expect(plain.slice(0, plain.indexOf("</li>"))).toMatch(/class="avatar[^"]*avatar-fill/);
  });

  it("keeps the bio to a line and the page small: a page of cards, never the whole cast", async () => {
    expect(bioLine("A".repeat(10) + " " + "word ".repeat(60))).toMatch(/…$/);
    expect(bioLine("A".repeat(10) + " " + "word ".repeat(60)).length).toBeLessThanOrEqual(141);
    expect(bioLine("  Two\n lines  ")).toBe("Two lines");
    const me = await admin();
    for (let i = 0; i < CHARACTERS_PAGE + 3; i++) await switchIn(me, await character(me, `Zed ${String(i).padStart(2, "0")}`));
    const one = await grid();
    expect(cards(one)).toHaveLength(CHARACTERS_PAGE);
    expect(one).toContain('href="/after-dark/characters?page=2"');
    const two = await grid({ page: "2" });
    const rest = 3 + HOUSE.length; // past the first page, A to Z: the 36 + 3 of theirs and the house cast
    expect(cards(two)).toHaveLength(rest);
    expect(new Set([...cards(one), ...cards(two)]).size).toBe(CHARACTERS_PAGE + rest);
  });
});

describe("finding one", () => {
  const cast = (rows: Partial<AdCharacter>[]): AdCharacter[] =>
    rows.map((r, i) => ({ id: `c${i}`, name: `Name ${i}`, bio: "", house: false, mine: false, hue: null, portrait: null, tags: [], nights: 0, ...r }));

  it("by name (accents and case aside), by whose, by type tag; theirs under way first, then A to Z", () => {
    const c = cast([
      { id: "ines", name: "Inès Rook", mine: true, tags: ["rebel"] },
      { id: "dex", name: "Dex Hale", house: true, tags: ["rebel", "grump"], nights: 1 },
      { id: "ada", name: "Ada Vance", house: true, nights: 3 },
      { id: "bo", name: "Bo Ines", tags: ["grump"] },
    ]);
    expect(filterCast(c, { q: "", whose: "all", tag: null }).map((x) => x.id)).toEqual(["ada", "dex", "bo", "ines"]);
    expect(filterCast(c, { q: "INES", whose: "all", tag: null }).map((x) => x.id)).toEqual(["bo", "ines"]);
    expect(filterCast(c, { q: "", whose: "house", tag: null }).map((x) => x.id)).toEqual(["ada", "dex"]);
    expect(filterCast(c, { q: "", whose: "mine", tag: null }).map((x) => x.id)).toEqual(["ines"]);
    expect(filterCast(c, { q: "", whose: "all", tag: "grump" }).map((x) => x.id)).toEqual(["dex", "bo"]);
    const chips = tagChips(c);
    expect(chips.map((x) => x.n)).toEqual([2, 2]);
    expect(new Set(chips.map((x) => x.tag.id))).toEqual(new Set(["rebel", "grump"]));
  });

  it("reads anything odd in the address as no filter, and builds the address back", () => {
    expect(parseCharacterFilter({})).toEqual({ q: "", whose: "all", tag: null, page: 1 });
    expect(parseCharacterFilter({ q: "  ines ", whose: "mine", tag: "rebel", page: "3" })).toEqual({ q: "ines", whose: "mine", tag: "rebel", page: 3 });
    expect(parseCharacterFilter({ whose: "theirs", tag: "rivals", page: "-1" })).toEqual({ q: "", whose: "all", tag: null, page: 1 }); // rivals is a setup, not a type
    expect(parseCharacterFilter({ q: "x".repeat(200) }).q).toHaveLength(64);
    expect(charactersHref({ q: "ines", whose: "all", tag: null, page: 1 })).toBe("/after-dark/characters?q=ines");
    expect(charactersHref({ whose: "house", tag: "rebel", page: 2 })).toBe("/after-dark/characters?whose=house&tag=rebel&page=2");
  });

  it("the page searches on the server and keeps the other filters", async () => {
    const w = await world();
    const found = await grid({ q: "valdecasas" });
    expect(cards(found)).toEqual([w.mineIn]);
    expect(found).toContain(`1 of ${HOUSE.length + 3}`);
    expect(found).toContain('value="valdecasas"');
    const yours = await grid({ whose: "mine" });
    expect(new Set(cards(yours))).toEqual(new Set([w.mineIn, w.minePrivate]));
    expect(yours).toContain('aria-current="true" data-whose="mine"');
    expect(await grid({ q: "nobody-by-this-name" })).toContain("data-ad-characters-none");
  });
});

describe("a character's page", () => {
  it("has their portrait, name, tags and bio; a night with them (the hub's picker with them picked); their nights; yours of them", async () => {
    const w = await world();
    await t.db.query(`insert into character_tags (character_id, tag, source) values ($1, 'sunshine', 'owner')`, [w.mineIn]);
    await night(w.me, w.mineIn, A.id, 3);
    await night(w.me, w.mineIn, w.mineOut, 3); // with one of theirs that's Out: not a card that opens
    const pic = await picture(w.me, w.mineIn, { b: A.id });
    await picture(w.me, B.id, { b: A.id }); // not of them
    const page = await profile(w.mineIn);
    expect(page).toContain("Ines Valdecasas-Rook</h1>");
    expect(page).toContain("Restores clocks in a shop that smells of oil.");
    expect(page).toMatch(/class="avatar[^"]*avatar-fill/);
    expect(page).toContain(`href="/after-dark?with=${w.mineIn}#scenes"`);
    expect(page).toContain(`A night with Ines`);
    expect(page).toContain(`href="${pairPath(w.mineIn, A.id)}"`);
    expect(page).not.toContain(pairPath(w.mineIn, w.mineOut));
    expect(page).toContain(`data-ad-character-media="${pic}"`);
    expect(page).toContain("An AI character. Fiction between adults.");
    // Step in only where it's open to them: admins, while the switch is on admins (lib/adult/step-in.ts).
    expect(page).toContain(`href="/after-dark/step-in?with=${w.mineIn}"`);
    expect((await nightsWith(t.db, w.me, w.mineIn)).map((n) => n.path)).toEqual([pairPath(w.mineIn, A.id)]);
    expect((await ownMedia(t.db, w.me, 10, { character: w.mineIn })).map((m) => m.id)).toEqual([pic]);
  });

  it("has no Step in for a subscriber while it's on admins", async () => {
    await subscriber();
    const page = await profile(A.id);
    expect(page).toContain(`${A.name}</h1>`);
    expect(page).toContain(`A night with ${first(A.name)}`);
    expect(page).not.toContain("/after-dark/step-in");
    // A house character stands as Step in's figure does (app/stage/CharacterFigure.tsx): their reviewed portrait, whole,
    // as the show's own picture (.avatar: the discreet blur leaves it alone). No cutouts in tests (lib/cutout.ts).
    expect(page).toContain('data-figure="portrait"');
    expect(page).toMatch(new RegExp(`<img[^>]*class="avatar character-figure-img"[^>]*src="/cast/${A.id}-`));
  });

  it("is not found for anyone the viewer may not have a night with, or an id that isn't anyone", async () => {
    const w = await world();
    for (const id of [w.theirsPrivate, w.theirsPrivateOpen, w.theirsIn, w.mineOut, OFF.id, randomUUID(), "../admin", ""]) {
      expect(await digest(AfterDarkCharacterPage({ params: Promise.resolve({ id }) })), id).toMatch(/404/);
    }
    expect(await digest(AfterDarkCharacterPage({ params: Promise.resolve({ id: w.agent }) }))).toBe("rendered");
  });

  it("the hub opens with them picked from ?with=, and ignores someone not in the cast", async () => {
    const w = await world();
    const hub = await html(await AfterDarkHome({ searchParams: Promise.resolve({ with: A.id }) }));
    expect(hub).toContain("ad-pp-slot is-next");
    expect(hub).toContain("Start over");
    for (const id of [w.theirsPrivate, OFF.id]) {
      const other = await html(await AfterDarkHome({ searchParams: Promise.resolve({ with: id }) }));
      expect(other).not.toContain("ad-pp-slot is-next");
    }
  });
});

describe("someone After Dark isn't open to", () => {
  it("gets the locked Characters at the grid, and a character's page sends them there", async () => {
    signIn(randomUUID());
    jar.cookies.set(ADULT_COOKIE, "1");
    const page = await grid();
    expect(page).toContain('data-locked-preview="characters"');
    expect(page).toContain(`href="/after-dark/subscribe?source=${PREVIEW_SOURCE.characters}"`);
    expect(page).not.toContain(`data-character=`);
    expect(PREVIEW_TILES.characters).toBeGreaterThan(0);
    expect(await digest(AfterDarkCharacterPage({ params: Promise.resolve({ id: A.id }) }))).toMatch(/NEXT_REDIRECT;[a-z]+;\/after-dark\/characters;/);
  });

  it("signed out, the same", async () => {
    jar.cookies.set(ADULT_COOKIE, "1");
    expect(await grid()).toContain('data-locked-preview="characters"');
    expect(await digest(AfterDarkCharacterPage({ params: Promise.resolve({ id: A.id }) }))).toMatch(/\/after-dark\/characters;/);
  });
});

describe("the header", () => {
  const nav = (doors: { studio: boolean; showcase: boolean }) =>
    renderToStaticMarkup(createElement(Nav, { tokens: 0, meter: "none", adHost: true, afterDark: true, hasCharacter: true, adDoors: doors, showHref: "https://show.example" }));
  const current = (page: string, href: string) => [...page.matchAll(/<a\b[^>]*>/g)].some((m) => m[0].includes(`href="${href}"`) && m[0].includes('aria-current="page"'));

  it("is Scenes · Characters · Studio · Gallery, Characters marked on the grid and on a character's page", () => {
    expect(adLinks({ studio: true, showcase: true }).map((l) => l.label)).toEqual(["Scenes", "Characters", "Studio", "Gallery"]);
    expect(adLinks({ studio: false, showcase: false }).map((l) => l.label)).toEqual(["Scenes", "Characters", "Who's in", "Gallery"]);
    for (const path of ["/after-dark/characters", `/after-dark/characters/${A.id}`]) {
      jar.path = path;
      const page = nav({ studio: true, showcase: true });
      expect(page).toContain('href="/after-dark/characters"');
      expect(current(page, "/after-dark/characters"), path).toBe(true);
      expect(current(page, "/after-dark"), path).toBe(false);
      expect(current(page, "/after-dark/studio"), path).toBe(false);
    }
  });
});

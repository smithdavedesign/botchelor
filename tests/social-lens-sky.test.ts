import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The page reads the viewer from next/headers: an empty cookie jar (nobody's signed in).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
// The canvas needs a browser: the static render gets its placeholder.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import { GET as getLens } from "@/app/api/graph/lens/route";
import { setDbForTests } from "@/lib/db";
import { ensurePlace, setMembership } from "@/lib/social/places";
import { lensSky, LENS_PLACE_MEMBERS } from "@/lib/social/lens-sky";
import type { LensSky } from "@/lib/social/lenses";
import { upsertTie } from "@/lib/social/ties";
import type { PlaceKind, PlaceRole, TieInput } from "@/lib/social/types";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The Constellation's social views as /graph draws them (lib/social/lens-sky.ts, /api/graph/lens, ?lens= on /graph):
// publicSky's ties folded into lines, its places as stars, its characters as the Constellation's nodes, its numbers.

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

const ID = (k: string) => `ls-${k}`;
const [ADA, BEA, CAL, IVY, EVE] = ["ada", "bea", "cal", "ivy", "eve"].map(ID);
const owner = userIdOf(newUserCookie());

async function character(k: string, o: { visibility?: string; kind?: string } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, avatar_hue, extras)
     values ($1, $2, false, $3, 30, 'Keeps bees and opinions.', '["kind"]'::jsonb, 'someone kind', 'liars', $4, 120, $5::jsonb)`,
    [ID(k), owner, `Lens ${k[0].toUpperCase()}${k.slice(1)}`, o.visibility ?? "public", JSON.stringify(o.kind ? { kind: o.kind } : {})],
  );
}
const tie = async (input: TieInput) => {
  const w = await upsertTie(t.db, input);
  if (!w.ok) throw new Error(`tie refused: ${w.reason}`);
};
async function place(key: string, kind: PlaceKind, name: string) {
  return (await ensurePlace(t.db, { key: `ls-${key}`, kind, name, source: "admin" })).id;
}
const member = (placeId: string, k: string, role: PlaceRole) => setMembership(t.db, { placeId, characterId: ID(k), role, source: "owner" });

/**
 * Ada and Bea are friends who dated, Bea and Cal siblings, Ada and Cal had it out, Cal and Ivy were rivals (over now),
 * Bea told Cal something, and Ada has a rivalry with Eve, who's private. Ada, Bea and Eve are regulars at the dive bar;
 * Ada, Cal and Ivy are all from Leeds.
 */
async function seed() {
  await character("ada", { kind: "vampire" });
  for (const k of ["bea", "cal", "ivy"]) await character(k);
  await character("eve", { visibility: "private" });
  await tie({ from: ADA, to: BEA, kind: "friend", source: "owner" });
  await tie({ from: ADA, to: BEA, kind: "dated", source: "derived", layer: "romance", valence: 2, closeness: 0.9 });
  await tie({ from: BEA, to: CAL, kind: "sibling", source: "owner" });
  await tie({ from: ADA, to: CAL, kind: "feud", source: "derived", evidence: { ref: "episode:e1", at: "2026-11-02T20:00:00.000Z" } });
  await tie({ from: CAL, to: IVY, kind: "rival", source: "house", status: "ended" });
  await tie({ from: BEA, to: CAL, kind: "told", source: "derived", detail: { count: 2 }, evidence: { ref: "scene:s1#2" } });
  await tie({ from: ADA, to: EVE, kind: "rival", source: "house" });
  const bar = await place("dive-bar", "venue", "the dive bar");
  const leeds = await place("leeds", "hometown", "Leeds");
  for (const k of ["ada", "bea", "eve"]) await member(bar, k, "regular");
  for (const k of ["ada", "cal", "ivy"]) await member(leeds, k, "from");
  return { bar, leeds };
}

const pairsOf = (s: LensSky) => s.pairs.map((p) => `${p.a.slice(3)}-${p.b.slice(3)}:${p.masked ? "masked" : p.lines.map((l) => `${l.g}/${l.k.join("+")}${l.d ? `>${l.d}` : ""}${l.e ? "(over)" : ""}`).join(",")}`);

describe("a view, built for the canvas", () => {
  it("friends: the lines in their groups, each place a star with its public members, the characters as the Constellation's", async () => {
    const { bar, leeds } = await seed();
    const s = (await lensSky(t.db, "friends"))!;
    expect(pairsOf(s).sort()).toEqual(["ada-bea:friendship/friend", "bea-cal:kin/sibling"]);
    expect(s.places.map((p) => [p.words, p.group, p.count, [...p.members].sort()])).toEqual([
      ["Both from Leeds", "place", 3, [ADA, CAL, IVY].sort()],
      ["Regulars at the dive bar", "place", 2, [ADA, BEA].sort()],
    ]);
    expect(s.places.map((p) => p.id)).toEqual([`place:${leeds}:from`, `place:${bar}:regular`]);
    const ada = s.nodes.find((n) => n.id === ADA)!;
    // Her one line here and her two places; who made her and what she is, for the filters.
    expect(ada).toMatchObject({ name: "Lens Ada", private: false, origin: "person", kind: "vampire", kind_label: "🧛 Vampire", hue: 120, degree: 3 });
    expect(s.nodes.some((n) => n.id === EVE)).toBe(false);
    // Their dates are Love's (romance): the friendship is the one here.
    expect(s.numbers).toEqual([
      { n: 1, words: "friendships" },
      { n: 1, words: "family ties" },
      { n: 2, words: "shared places" },
      { n: 1, words: "most friends", who: { id: ADA, name: "Lens Ada" } },
    ]);
    expect(s).toMatchObject({ lens: "friends", ties: 2, shown: 2 });
  });

  it("rivals: each kind of conflict, what's over, and who's most at odds; the private rivalry nowhere", async () => {
    await seed();
    const s = (await lensSky(t.db, "rivals"))!;
    expect(pairsOf(s).sort()).toEqual(["ada-cal:feud/feud", "cal-ivy:rival/rival(over)"]);
    expect(s.places).toEqual([]);
    expect(s.numbers).toEqual([
      { n: 1, words: "feuds" },
      { n: 1, words: "rivalries" },
      { n: 2, words: "most at odds", who: { id: CAL, name: "Lens Cal" } },
    ]);
    expect(JSON.stringify(s)).not.toContain(EVE);
  });

  it("gossip: who told whom, with its direction", async () => {
    await seed();
    const s = (await lensSky(t.db, "gossip"))!;
    expect(pairsOf(s)).toEqual(["bea-cal:told/told>1"]);
    expect(s.numbers).toEqual([
      { n: 2, words: "lines of gossip" },
      { n: 2, words: "biggest talker", who: { id: BEA, name: "Lens Bea" } },
    ]);
  });

  it("everything: every layer side by side, and a private character's pair as existence only, its name and nothing else", async () => {
    await seed();
    const s = (await lensSky(t.db, "all"))!;
    expect(pairsOf(s).find((p) => p.startsWith("ada-bea"))).toBe("ada-bea:romance/dated,friendship/friend");
    expect(pairsOf(s)).toContain("ada-eve:masked");
    expect(s.nodes.find((n) => n.id === EVE)).toEqual({ id: EVE, name: "Lens Eve", hue: null, origin: null, portrait: null, private: true, degree: 1, kind: null, kind_label: null, community: null });
    // Love's pair is in a cluster with her friends; a private character is in none.
    expect(s.nodes.find((n) => n.id === ADA)!.community).not.toBeNull();
    expect(s.numbers[0]).toEqual({ n: 6, words: "ties" });
    expect(s.numbers.some((n) => n.who?.id === EVE)).toBe(false);
  });

  it("names each place's members up to its cap, and is null with its switch or SOCIAL_TIES off", async () => {
    await seed();
    const big = await place("gym", "workplace", "the gym");
    const crowd = Array.from({ length: LENS_PLACE_MEMBERS + 3 }, (_, i) => `gym${i}`);
    for (const k of crowd) await character(k);
    for (const k of crowd) await member(big, k, "works");
    const s = (await lensSky(t.db, "friends"))!;
    const gym = s.places.find((p) => p.place_id === big)!;
    expect(gym).toMatchObject({ words: "Coworkers at the gym", group: "work", count: crowd.length });
    expect(gym.members).toHaveLength(LENS_PLACE_MEMBERS);
    expect(await lensSky(t.db, "friends", { env: { SOCIAL_LENSES: "0" } })).toBeNull();
    expect(await lensSky(t.db, "friends", { env: { SOCIAL_TIES: "0" } })).toBeNull();
  });
});

describe("/api/graph/lens", () => {
  const get = async (q: string) => {
    const res = await getLens(new Request(`${BASE_URL}/api/graph/lens${q}`));
    return { status: res.status, cache: res.headers.get("cache-control"), body: (await res.json()) as LensSky & { error?: string } };
  };

  it("serves a view to everyone alike, 400 for one it doesn't know, 404 when the views are off", async () => {
    await seed();
    const ok = await get("?lens=rivals");
    expect(ok.status).toBe(200);
    expect(ok.cache).toBe("public, max-age=60");
    expect(ok.body.pairs).toHaveLength(2);
    expect((await get("?lens=love")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    vi.stubEnv("SOCIAL_LENSES", "0");
    expect((await get("?lens=rivals")).status).toBe(404);
  });
});

describe("/graph's views", () => {
  const page = async (sp: Record<string, string> = {}) => {
    const { default: GraphPage } = await import("@/app/graph/page");
    return renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve(sp) }));
  };
  const tab = (label: string, current: boolean) =>
    new RegExp(`<a class="segmented-tab" href="[^"]*"${current ? ' aria-current="page"' : ""} data-track="graph-lens-[a-z]+">${label}</a>`);

  it("opens on Love, the Constellation, with the views to pick from", async () => {
    await seed();
    const html = await page();
    expect(html).toContain('aria-label="Views of the sky"');
    expect(html).toMatch(tab("Love", true));
    expect(html).toMatch(tab("Friends and family", false));
    expect(html).toContain('href="/graph?lens=gossip"');
    // Love's own chips and numbers, as before.
    expect(html).toContain("--chip-line:var(--constellation-together)");
    expect(html).toContain("waiting for a first date");
  });

  it("?lens=rivals opens on that view: its chips with their counts, its numbers and its legend, drawn at once", async () => {
    await seed();
    const html = await page({ lens: "rivals" });
    expect(html).toMatch(tab("Rivals", true));
    expect(html).toMatch(tab("Love", false));
    expect(html).toMatch(/Had it out<span class="constellation-stage-count">1<span class="sr-only"> line<\/span><\/span>/);
    expect(html).not.toContain("--chip-line:var(--constellation-together)");
    expect(html).toContain("<strong>1</strong> feuds");
    expect(html).toContain("most at odds: <strong>Lens Cal</strong> (2)");
    expect(html).toContain("a grey line cleared the air");
    // Love's dating filters aren't this view's.
    expect(html).not.toContain("Still seeing each other");
  });

  it("with SOCIAL_LENSES=0 the page is the Constellation as it was", async () => {
    await seed();
    vi.stubEnv("SOCIAL_LENSES", "0");
    const html = await page({ lens: "rivals" });
    expect(html).not.toContain("Views of the sky");
    expect(html).not.toContain("feuds");
    expect(html).toContain("--chip-line:var(--constellation-together)");
  });
});

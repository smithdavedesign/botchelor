import type { CastMember, CastPair } from "./scenes";

/**
 * The hub's pair picker, as plain functions (app/after-dark/PairPicker.tsx; David, 2026-11-18: "change the choose a new
 * pair to be better ux like a picker with a search"): who's in, what the panel shows for what's picked and typed, the
 * Everyone · House cast · Yours filter, and 🎲. No server code: the picker runs in the browser.
 *
 * The page sends the cast and the nights under way, never every pair: any two of After Dark's cast are a pair
 * (lib/adult/scenes.ts listCastPairs), and 151 of them made 11,325 pairs, a 4.6 MB hub (measured 2026-11-18). A pair
 * nobody has started is made here from its two faces, at the same address the server gives it (pairPath).
 */

/** Whose faces the picker shows: everyone, the house cast's, or the viewer's own. */
export type Whose = "all" | "house" | "mine";
/** One labelled run of faces in the panel, each with what's under way between them and the first pick, if anything. */
export type PickGroup = { label: string; faces: { c: CastMember; meta?: string }[] };
/** What the picker is given: After Dark's cast (A to Z) and the nights under way (the latest played first). */
export type PickerData = { cast: CastMember[]; nights: CastPair[]; firstScene: string };

/** A name as it's searched: lower case, accents off ("Inès" is found by "ines"). */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const first = (n: string) => n.split(/\s+/)[0];

/**
 * Those of `cast` whose name holds `query` (accents and case aside), a name with a word that starts with it first, then A
 * to Z; everyone, A to Z, with nothing typed. For picking one face (Step in's set-up), where pickGroups picks two.
 */
export function byName<T extends { name: string }>(cast: readonly T[], query: string): T[] {
  const q = fold(query.trim());
  const starts = (c: T) => (q && fold(c.name).split(/\s+/).some((w) => w.startsWith(q)) ? 0 : 1);
  return cast.filter((c) => !q || fold(c.name).includes(q)).sort((x, y) => starts(x) - starts(y) || x.name.localeCompare(y.name));
}

/**
 * Step in's picker, one face: with nothing typed, the faces from their scenes (the latest first), then the house cast, then
 * everyone else, A to Z; with something typed, the matches (byName). Empty groups are left out.
 */
export function oneFaceGroups<T extends { id: string; name: string; house?: boolean }>(cast: readonly T[], recent: readonly string[], query: string): { label: string; faces: T[] }[] {
  if (query.trim()) {
    const found = byName(cast, query);
    return found.length ? [{ label: `${found.length} ${found.length === 1 ? "match" : "matches"}`, faces: found }] : [];
  }
  const ids = [...new Set(recent)];
  const theirs = ids.map((id) => cast.find((c) => c.id === id)).filter((c): c is T => Boolean(c));
  const left = byName(cast, "").filter((c) => !ids.includes(c.id));
  const house = left.filter((c) => c.house);
  const rest = left.filter((c) => !c.house);
  return [
    { label: "From your scenes", faces: theirs },
    { label: "House cast", faces: house },
    { label: theirs.length || house.length ? "Everyone else" : `Everyone · ${rest.length}`, faces: rest },
  ].filter((g) => g.faces.length);
}

/** Under way: lines, a chapter filed, or kept from an earlier cast. */
export const underWay = (p: CastPair): boolean => Boolean(p.earlier) || p.lines > 0 || (p.chapter ?? 1) > 1;

/** The nights under way, the latest played first. */
export const nightsOf = (pairs: readonly CastPair[]): CastPair[] => pairs.filter(underWay).sort((x, y) => (y.updated_at ?? "").localeCompare(x.updated_at ?? ""));

/** A pair's scene: its two ids in order (listCastPairs pairs the cast sorted, the first id first). */
export const pairPath = (x: string, y: string): string => `/after-dark/${[x, y].sort().join("/")}`;

/**
 * The picker's data from every pair: the cast a new pair is picked from (this season's: a pair kept from an earlier cast
 * is under Continue only, #1132), each once, with the face kept for this viewer where a night of theirs carries it; the
 * nights under way; and the first pair's scene (data-first-scene, for the screenshot scripts).
 */
export function pickerData(pairs: readonly CastPair[]): PickerData {
  const seen = new Map<string, CastMember>();
  for (const p of pairs) {
    if (p.earlier) continue;
    for (const c of [p.a, p.b]) if (!seen.has(c.id) || (c.photo && !seen.get(c.id)!.photo)) seen.set(c.id, c);
  }
  return { cast: [...seen.values()].sort((x, y) => x.name.localeCompare(y.name)), nights: nightsOf(pairs), firstScene: pairs[0]?.path ?? "" };
}

/** These two as a pair: their night under way (either way round, this season's), or a new one; null for one face or someone not in the cast. */
export function pairOf(cast: readonly CastMember[], nights: readonly CastPair[], x: string, y: string): CastPair | null {
  if (x === y) return null;
  const night = nights.find((p) => !p.earlier && ((p.a.id === x && p.b.id === y) || (p.a.id === y && p.b.id === x)));
  if (night) return night;
  const a = cast.find((c) => c.id === x);
  const b = cast.find((c) => c.id === y);
  if (!a || !b) return null;
  const [one, two] = a.id < b.id ? [a, b] : [b, a];
  return { a: one, b: two, lines: 0, path: pairPath(a.id, b.id) };
}

/**
 * How many faces each of the panel's groups shows before its "Show all" (the 2026-11-22 audit: the hub drew all 227 of
 * the cast, and a desktop loaded every one of them, 4 MB of faces, for a box that shows about twenty at once). Search
 * still looks through everyone.
 */
export const FACES_SHOWN = 12;

/** Each group cut to `n` faces (all of them when `n` is Infinity), with how many it leaves out. */
export function capGroups(groups: readonly PickGroup[], n: number): (PickGroup & { hidden: number })[] {
  return groups.map((g) => (g.faces.length > n ? { ...g, faces: g.faces.slice(0, n), hidden: g.faces.length - n } : { ...g, hidden: 0 }));
}

/** How many of the cast each filter holds. */
export const whoseCounts = (cast: readonly CastMember[]): Record<Whose, number> => ({
  all: cast.length,
  house: cast.filter((c) => c.house).length,
  mine: cast.filter((c) => c.mine).length,
});

/** The filters worth showing: only where one splits the cast (some of the house's and some not, or some of theirs). */
export function whoseFilters(counts: Record<Whose, number>): Whose[] {
  const mine: Whose[] = counts.mine && counts.mine < counts.all ? ["mine"] : [];
  if (counts.house > 0 && counts.house < counts.all) return ["all", "house", ...mine];
  return mine.length ? ["all", ...mine] : [];
}

/**
 * What the panel shows. Nothing picked: with nothing typed, the faces from their nights (the latest played first), then
 * the house cast (when they're only some of the rest), then everyone else, A to Z; with something typed, the matches, a
 * name that starts with it (any of its words) first. One picked: everyone they can be with, theirs under way first (each
 * saying how far it's got), then someone new, the house cast first. Empty groups are left out. The panel shows the first
 * FACES_SHOWN of each (capGroups) until "Show all".
 */
export function pickGroups(cast: readonly CastMember[], nights: readonly CastPair[], pick: { one: string | null; query: string; whose: Whose }): PickGroup[] {
  const q = fold(pick.query.trim());
  const fits = (c: CastMember) => (pick.whose === "house" ? Boolean(c.house) : pick.whose === "mine" ? Boolean(c.mine) : true) && (!q || fold(c.name).includes(q));
  const starts = (c: CastMember) => (fold(c.name).split(/\s+/).some((w) => w.startsWith(q)) ? 0 : 1);
  const byMatch = (x: CastMember, y: CastMember) => starts(x) - starts(y) || x.name.localeCompare(y.name);
  const picked = cast.find((c) => c.id === pick.one) ?? null;
  const out: PickGroup[] = [];
  if (!picked) {
    const pool = cast.filter(fits);
    if (q) return pool.length ? [{ label: `${pool.length} ${pool.length === 1 ? "match" : "matches"}`, faces: [...pool].sort(byMatch).map((c) => ({ c })) }] : [];
    const regular: string[] = [];
    for (const p of nights) for (const c of [p.a, p.b]) if (!regular.includes(c.id)) regular.push(c.id);
    const recent = regular.map((id) => pool.find((c) => c.id === id)).filter((c): c is CastMember => Boolean(c));
    const rest = pool.filter((c) => !regular.includes(c.id));
    const house = rest.filter((c) => c.house);
    if (recent.length) out.push({ label: "From your nights", faces: recent.map((c) => ({ c })) });
    // The house cast before the rest: with each group cut short, they're the faces people know (16 of 227 on 11-22).
    if (house.length && house.length < rest.length) {
      out.push({ label: "House cast", faces: house.map((c) => ({ c })) });
      out.push({ label: "Everyone else", faces: rest.filter((c) => !c.house).map((c) => ({ c })) });
    } else out.push({ label: recent.length ? "Everyone else" : `Everyone · ${rest.length}`, faces: rest.map((c) => ({ c })) });
    return out.filter((g) => g.faces.length);
  }
  const night = (c: CastMember) => nights.find((p) => !p.earlier && ((p.a.id === picked.id && p.b.id === c.id) || (p.a.id === c.id && p.b.id === picked.id))) ?? null;
  const partners = cast.filter((c) => c.id !== picked.id && fits(c));
  const theirs = partners.filter((c) => night(c)).sort((x, y) => (night(y)?.updated_at ?? "").localeCompare(night(x)?.updated_at ?? ""));
  const fresh = partners.filter((c) => !night(c)).sort(q ? byMatch : (x, y) => Number(Boolean(y.house)) - Number(Boolean(x.house)) || x.name.localeCompare(y.name));
  const how = (p: CastPair) => (p.chapter && p.chapter > 1 ? `Chapter ${p.chapter}` : `${p.lines} lines`);
  if (theirs.length) out.push({ label: `Their nights with ${first(picked.name)}`, faces: theirs.map((c) => ({ c, meta: how(night(c)!) })) });
  out.push({ label: theirs.length ? "Someone new" : `Who ${first(picked.name)} can be with · ${fresh.length}`, faces: fresh.map((c) => ({ c })) });
  return out.filter((g) => g.faces.length);
}

/** 🎲: two of the cast who haven't started a night, at random (any two once every draw finds one under way). */
export function surprisePair(cast: readonly CastMember[], nights: readonly CastPair[], random: () => number = Math.random): CastPair | null {
  if (cast.length < 2) return null;
  const at = (n: number) => Math.min(n - 1, Math.floor(random() * n));
  let last: CastPair | null = null;
  for (let tries = 0; tries < 24; tries++) {
    const x = cast[at(cast.length)];
    const others = cast.filter((c) => c.id !== x.id);
    const pair = pairOf(cast, nights, x.id, others[at(others.length)].id);
    if (pair && !underWay(pair)) return pair;
    last = pair ?? last;
  }
  return last;
}

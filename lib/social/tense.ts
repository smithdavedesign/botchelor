/**
 * Tense triangles (docs/PRDs/social-network.md section 9, Phase 3): the public network's unbalanced triangles, as story
 * hooks for /graph. Two at odds who are both close to a third ("Ada and Bea are feuding, and both are close to Cal"),
 * or three at odds with each other. Structural balance says neither holds still: one of them gives.
 *
 * From the public, active ties between public, listed characters only (what Everything draws: lib/social/read.ts
 * publicSky), a pair's sign its ties' valences summed (lib/social/algorithms.ts signedTriads: coworkers who are also
 * rivals are neither). Never a person's ties, the owner layers or anyone's opinions. A sour pair's triangles are one
 * hook ("Ada and Bea are at odds, and both dated Cal, Dee and 3 more"), keeping what made the sour side (its ties' kinds
 * and newest evidence), the hooks that moved last first. Cached a minute under the Constellation's tag, like the views.
 */
import { unstable_cache } from "next/cache";
import { getDb, type Db } from "../db";
import { GRAPH_TAG, GRAPH_TTL_SECONDS } from "../graph-cache";
import { signedTriads, type Sign } from "./algorithms";
import { withinWindow, type Stamped } from "./cache";
import { isTieKind, type TieKindId } from "./kinds";
import { listedSql } from "./read";
import type { Evidence } from "./types";
import { socialLensesOn } from "./lens-sky";

type Env = Record<string, string | undefined>;

/** How many triangles the census keeps, how many hooks /graph lists, and how many thirds a hook names before "and N more". */
export const TENSE_KEPT = 500;
export const TENSE_SHOWN = 12;
export const TENSE_ABOUT = 4;

export type TenseSide = { a: string; b: string; sign: Sign; kinds: TieKindId[]; evidence: Evidence[]; at: string | null };
/**
 * One story hook. "two": `a` and `b` are at odds and both close to each of `about` (every triangle that sour pair is in,
 * gathered, so one feud with eleven shared exes is one hook, not eleven). "three": `a`, `b` and `about[0]` all at odds.
 */
export type TenseHook = {
  /** The sour pair's ids ("two") or the three's ("three"), in id order. */
  key: string;
  shape: "two" | "three";
  a: string;
  b: string;
  /** Who they're both close to, the most recent first, at most TENSE_ABOUT ("three": the third). */
  about: string[];
  /** How many more they're both close to. */
  more: number;
  /** What ties the two to their thirds (the warm sides' kinds), so "both dated" can say so. */
  warm: TieKindId[];
  /** The sour sides, with what made them: the one between `a` and `b`, or all three. */
  sides: TenseSide[];
  /** When its newest side last moved. */
  at: string | null;
};
export type TenseSky = {
  hooks: TenseHook[];
  /** How many hooks there are in all, before the newest are picked. */
  groups: number;
  names: Record<string, string>;
  unbalanced: number;
  balanced: number;
};

type Row = { id: string; from_id: string; to_id: string; kind: string; valence: number; at: string | Date | null };

const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);
const iso = (v: string | Date | null): string | null => (v === null ? null : new Date(v).toISOString());
const latest = (ts: readonly (string | null)[]): string | null => ts.filter((t): t is string => t !== null).sort().at(-1) ?? null;
const newestFirst = (p: string | null, q: string | null): number => (q ?? "").localeCompare(p ?? "");

/** The unbalanced triangles in these ties, gathered into hooks by who's at odds, newest first (pure). */
export function tenseFrom(
  rows: readonly Row[],
  o: { kept?: number; shown?: number; about?: number } = {},
): { hooks: TenseHook[]; groups: number; unbalanced: number; balanced: number } {
  const census = signedTriads(
    rows.map((r) => ({ from: r.from_id, to: r.to_id, valence: Number(r.valence) })),
    { limit: o.kept ?? TENSE_KEPT },
  );
  const byPair = new Map<string, Row[]>();
  for (const r of rows) byPair.set(pairKey(r.from_id, r.to_id), [...(byPair.get(pairKey(r.from_id, r.to_id)) ?? []), r]);
  const side = (x: string, y: string, sign: Sign): TenseSide => {
    const ties = byPair.get(pairKey(x, y)) ?? [];
    // The ties that pull the side its way: a sour side's sour ties, a warm side's warm ones.
    const pulling = ties.filter((t) => (sign < 0 ? t.valence < 0 : t.valence > 0));
    return { a: x < y ? x : y, b: x < y ? y : x, sign, kinds: [...new Set(pulling.map((t) => t.kind).filter(isTieKind))], evidence: [], at: latest(pulling.map((t) => iso(t.at))) };
  };
  type Group = Omit<TenseHook, "about" | "more" | "warm"> & { thirds: { id: string; at: string | null }[]; warm: Set<TieKindId> };
  const groups = new Map<string, Group>();
  for (const tri of census.triads) {
    if (tri.balanced) continue;
    const [x, y, z] = tri.ids;
    const [xy, xz, yz] = tri.signs;
    const sides = [side(x, y, xy), side(x, z, xz), side(y, z, yz)];
    const at = latest(sides.map((s) => s.at));
    // Three sour sides (an unbalanced triangle has one or three): everyone's at odds, a hook of its own.
    if (tri.signs.every((s) => s < 0)) {
      groups.set(tri.ids.join("|"), { key: tri.ids.join("|"), shape: "three", a: x, b: y, thirds: [{ id: z, at }], warm: new Set(), sides, at });
      continue;
    }
    // One: its two are at odds and the third is close to both. The sour pair's triangles are one hook.
    const sour = sides.find((s) => s.sign < 0)!;
    const key = `${sour.a}|${sour.b}`;
    const g = groups.get(key) ?? { key, shape: "two" as const, a: sour.a, b: sour.b, thirds: [], warm: new Set<TieKindId>(), sides: [sour], at: null };
    g.thirds.push({ id: tri.ids.find((id) => id !== sour.a && id !== sour.b)!, at });
    for (const s of sides) if (s.sign > 0) for (const k of s.kinds) g.warm.add(k);
    g.at = latest([g.at, at]);
    groups.set(key, g);
  }
  const keep = o.about ?? TENSE_ABOUT;
  const hooks: TenseHook[] = [...groups.values()]
    .map(({ thirds, warm, ...g }) => {
      const about = thirds.sort((p, q) => newestFirst(p.at, q.at) || p.id.localeCompare(q.id)).map((t) => t.id);
      return { ...g, about: about.slice(0, keep), more: Math.max(0, about.length - keep), warm: [...warm].sort() };
    })
    .sort((p, q) => newestFirst(p.at, q.at) || p.key.localeCompare(q.key));
  return { hooks: hooks.slice(0, o.shown ?? TENSE_SHOWN), groups: hooks.length, unbalanced: census.unbalanced, balanced: census.balanced };
}

/** The public network's tense triangles; null with the views switched off. */
export async function tenseSky(db: Db, o: { env?: Env } = {}): Promise<TenseSky | null> {
  if (!socialLensesOn(o.env ?? process.env)) return null;
  const { rows } = await db.query<Row>(
    `select t.id, t.from_id, t.to_id, t.kind, t.valence, coalesce(t.last_contact_at, t.started_at, t.updated_at) as at
       from social_ties t
       join characters a on a.id = t.from_id and a.visibility = 'public' and ${listedSql("a")}
       join characters b on b.id = t.to_id and b.visibility = 'public' and ${listedSql("b")}
      where t.to_id is not null and t.visibility = 'public' and t.status = 'active' and t.valence <> 0
      order by t.id`,
  );
  const found = tenseFrom(rows);
  if (!found.hooks.length) return { ...found, names: {} };
  // What made each sour side, for the hooks shown only: its sour ties' evidence, newest first.
  const ids = new Set(found.hooks.flatMap((h) => [h.a, h.b, ...h.about]));
  const wanted = new Set(found.hooks.flatMap((h) => h.sides.map((s) => pairKey(s.a, s.b))));
  const tieIds = rows.filter((r) => Number(r.valence) < 0 && wanted.has(pairKey(r.from_id, r.to_id))).map((r) => r.id);
  const [ev, names] = await Promise.all([
    db.query<{ from_id: string; to_id: string; evidence: Evidence[] }>(`select from_id, to_id, evidence from social_ties where id = any($1::text[])`, [tieIds]),
    db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1::text[])`, [[...ids]]),
  ]);
  const evidenceOf = new Map<string, Evidence[]>();
  for (const r of ev.rows) evidenceOf.set(pairKey(r.from_id, r.to_id), [...(evidenceOf.get(pairKey(r.from_id, r.to_id)) ?? []), ...(Array.isArray(r.evidence) ? r.evidence : [])]);
  for (const h of found.hooks)
    for (const s of h.sides) s.evidence = (evidenceOf.get(pairKey(s.a, s.b)) ?? []).sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, 3);
  return { ...found, names: Object.fromEntries(names.rows.map((r) => [r.id, r.name])) };
}

const cachedBuild = unstable_cache(
  async (): Promise<Stamped<TenseSky | null>> => ({ at: Date.now(), data: await tenseSky(await getDb()) }),
  ["social-tense", "v2"],
  { tags: [GRAPH_TAG], revalidate: GRAPH_TTL_SECONDS },
);

/** The tense triangles as /graph lists them, at most a few minutes old. */
export async function cachedTenseSky(db?: Db): Promise<TenseSky | null> {
  if (!socialLensesOn()) return null;
  return withinWindow(cachedBuild, async () => tenseSky(db ?? (await getDb())));
}

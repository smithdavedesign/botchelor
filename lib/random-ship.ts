/**
 * The random ship generator (app/tools/random-ship-generator): one click pairs two characters, and shows their ship
 * name (the ship name generator's best blend, lib/ship-names.ts) and how well they'd get on (the ship compatibility
 * test's chemistry, lib/chemistry-test.ts).
 *
 * The characters come from two places:
 *  - the show's cast: public characters with a date that aired publicly, made by a person or by the show (the
 *    sitemap's bar, lib/seo.ts authoredCharacterSql), as anyone sees them on their page: a name, three traits, what
 *    they want and a portrait. Never their dealbreaker, which their public page doesn't show either, so their chemistry
 *    reads their traits and want only;
 *  - the random OC generator's characters (lib/random-oc.ts): whole sheets from hand-written lists.
 *
 * Pair n (the address's ?pair=n; 1 on the tool's own page) is a pure function of n and the cast: two from the show, one
 * from the show and an OC, then two OCs, in turn. Each slot takes the cast member whose seeded draw for that pair and
 * slot is lowest, so a new face changes a pair only when it wins it, and a shared link mostly keeps its pair. No model,
 * nothing stored. RANDOM_SHIP_CAST=0 leaves the cast out: OC pairs only, and no database read.
 */
import { chemistryResultHref, chemistryTest, NO_DEALBREAKER_REASON, type OcSheet } from "./chemistry-test";
import type { Db } from "./db";
import { seeded } from "./oc-names";
import { portraitPathSql } from "./portrait-sql";
import { listedCharacterSql } from "./public-cast";
import { createFromOc, RANDOM_OC_MAX_BATCH, randomOcs, type RandomOc } from "./random-oc";
import type { Ending } from "./rules";
import { checkFields } from "./safety";
import { authoredCharacterSql, authoredDateSql } from "./seo";
import { shared } from "./shared-cache";
import { readName, shipPair, shipPath, type ShipBlend } from "./ship-names";

export const RANDOM_SHIP_PATH = "/tools/random-ship-generator";
/** The highest pair an address takes; past it the number wraps around. */
export const RANDOM_SHIP_MAX = 999;
/** The most of the cast one read takes. */
const CAST_MAX = 400;

/** The cast in the pairs (the default), unless RANDOM_SHIP_CAST=0: OC pairs only, and no database read. */
export function randomShipCastOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.RANDOM_SHIP_CAST?.trim() !== "0";
}

/** One of the show's cast as the tool shows them: their public face only, never the dealbreaker. */
export type ShipCastMember = { id: string; name: string; traits: string[]; want: string; house: boolean; portrait: string | null };
export type ShipSide = { kind: "cast"; cast: ShipCastMember } | { kind: "oc"; oc: RandomOc };
export type ShipMode = "cast-cast" | "cast-oc" | "oc-oc";

export type RandomShip = {
  n: number;
  mode: ShipMode;
  a: ShipSide;
  b: ShipSide;
  /** Their ship names, best first; empty when no blend of the two reads like a name. */
  ships: ShipBlend[];
  /** The compatibility test's chemistry, from the fields the page may show. */
  chemistry: { score: number; ending: Ending; reasons: string[] };
  /** The way into the show: the pair's ship page when both are from the cast, else /create with the OC in it. */
  wayIn: { kind: "ship" | "create"; href: string; label: string };
  /** The full chemistry result, for two OCs (whole sheets anyone can see). */
  fullHref: string | null;
};

/** A name's first word: ship names are blended from first names. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? "";
const sameFirst = (x: string, y: string) => firstName(x).toLowerCase() === firstName(y).toLowerCase();

/** A pair number from an address: a whole number from 1 to RANDOM_SHIP_MAX, otherwise 1. */
export function readShipNumber(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof value === "string" && /^\d{1,6}$/.test(value) ? Number(value) : 1;
  return n >= 1 ? ((n - 1) % RANDOM_SHIP_MAX) + 1 : 1;
}

/** A pair's address. The first is the tool's own page. */
export function randomShipHref(n: number): string {
  return n === 1 ? RANDOM_SHIP_PATH : `${RANDOM_SHIP_PATH}?pair=${n}`;
}

/** The pair after this one, wrapping at RANDOM_SHIP_MAX. */
export const nextShip = (n: number): number => (n % RANDOM_SHIP_MAX) + 1;

/**
 * The cast the pairs draw from: public characters with a public, aired date, made by a person or the show (the
 * sitemap's bar), whose first name makes ship names and passes the show's filter. Their public face only.
 */
export async function loadShipCast(db: Db): Promise<ShipCastMember[]> {
  const { rows } = await db.query<{ id: string; name: string; traits: unknown; want: string | null; is_house: boolean; portrait: string | null }>(
    `select c.id, c.name, c.traits, c.want, c.is_house, ${portraitPathSql("c")} as portrait
       from characters c
      where c.visibility = 'public' and ${listedCharacterSql("c")} and ${authoredCharacterSql("c")}
        and exists (select 1 from episodes e
                     where (e.character_a = c.id or e.character_b = c.id)
                       and e.visibility = 'public' and e.status = 'ready' and e.revealed_at is not null
                       and ${authoredDateSql("e")})
      order by c.id
      limit ${CAST_MAX}`,
  );
  return rows.flatMap((r) => {
    const traits = Array.isArray(r.traits) ? r.traits.filter((t): t is string => typeof t === "string" && t.trim() !== "").slice(0, 3) : [];
    if (!traits.length || !readName(firstName(r.name)) || !checkFields({ name: r.name }).ok) return [];
    return [{ id: r.id, name: r.name, traits, want: r.want ?? "", house: r.is_house, portrait: r.portrait }];
  });
}

/**
 * The cast for the page: one read shared by every visitor for a few seconds (lib/shared-cache.ts). Empty when switched
 * off, or when the database is slow to answer or down: the tool then pairs OCs, as it would with no cast at all.
 */
export async function shipCast(getDb: () => Promise<Db>, env: Record<string, string | undefined> = process.env): Promise<ShipCastMember[]> {
  if (!randomShipCastOn(env)) return [];
  return shared("random-ship:cast", async () => loadShipCast(await getDb())).catch(() => []);
}

/** Two from the show, one from the show and an OC, two OCs, in turn; fewer from the show when there are fewer. */
function modeFor(n: number, cast: number): ShipMode {
  if (cast >= 2) return (["cast-cast", "cast-oc", "oc-oc"] as const)[(n - 1) % 3];
  if (cast === 1) return n % 2 === 1 ? "cast-oc" : "oc-oc";
  return "oc-oc";
}

/** The cast member a slot of pair n takes: the lowest seeded draw among those it may take. */
function castFor(n: number, slot: "a" | "b", cast: readonly ShipCastMember[], skip: (c: ShipCastMember) => boolean = () => false): ShipCastMember | null {
  let best: ShipCastMember | null = null;
  let low = Number.POSITIVE_INFINITY;
  for (const c of cast) {
    if (skip(c)) continue;
    const draw = seeded(`random-ship|${n}|${slot}|${c.id}`)();
    if (draw < low) {
      low = draw;
      best = c;
    }
  }
  return best;
}

const nameOf = (s: ShipSide) => (s.kind === "cast" ? s.cast.name : s.oc.name);

/** A side as the compatibility test reads it: a show character's public fields, the dealbreaker left out. */
function sheetOf(s: ShipSide): OcSheet {
  if (s.kind === "oc") return { name: s.oc.name, traits: s.oc.traits, want: s.oc.want, dealbreaker: s.oc.dealbreaker };
  const [t1 = "", t2 = "", t3 = ""] = s.cast.traits;
  return { name: s.cast.name, traits: [t1, t2, t3], want: s.cast.want, dealbreaker: "" };
}

/** The two sides of pair n. */
function sidesFor(n: number, cast: readonly ShipCastMember[]): { mode: ShipMode; a: ShipSide; b: ShipSide } {
  const ocs = randomOcs({ batch: ((n - 1) % RANDOM_OC_MAX_BATCH) + 1 });
  const mode = modeFor(n, cast.length);
  if (mode !== "oc-oc") {
    const x = castFor(n, "a", cast);
    if (x) {
      const y = mode === "cast-cast" ? castFor(n, "b", cast, (c) => c.id === x.id || sameFirst(c.name, x.name)) : null;
      if (y) return { mode, a: { kind: "cast", cast: x }, b: { kind: "cast", cast: y } };
      const oc = ocs.find((o) => !sameFirst(o.name, x.name)) ?? ocs[0];
      return { mode: "cast-oc", a: { kind: "cast", cast: x }, b: { kind: "oc", oc } };
    }
  }
  return { mode: "oc-oc", a: { kind: "oc", oc: ocs[0] }, b: { kind: "oc", oc: ocs[1] } };
}

/** Pair n: the two, their ship names, their chemistry and the way into the show. */
export function randomShip(n: number, cast: readonly ShipCastMember[] = []): RandomShip {
  const { mode, a, b } = sidesFor(n, cast);
  const pair = shipPair(firstName(nameOf(a)), firstName(nameOf(b)));
  const ships = pair.ok ? pair.names : [];
  const [sheetA, sheetB] = [sheetOf(a), sheetOf(b)];
  const result = chemistryTest(sheetA, sheetB);
  // A show character's dealbreaker stays out, so "neither one's comes up" isn't the page's to say.
  const hidden = a.kind === "cast" || b.kind === "cast";
  const reasons = hidden ? result.reasons.filter((r) => r !== NO_DEALBREAKER_REASON) : [...result.reasons];
  const oc = a.kind === "oc" ? a.oc : b.kind === "oc" ? b.oc : null;
  const wayIn: RandomShip["wayIn"] =
    oc === null && pair.ok
      ? { kind: "ship", href: shipPath(pair.a, pair.b), label: "See their ship page" }
      : oc
        ? { kind: "create", href: createFromOc(oc), label: `Send ${firstName(oc.name)} on a real date` }
        : { kind: "create", href: "/create", label: "Make your own character" };
  return {
    n,
    mode,
    a,
    b,
    ships,
    chemistry: { score: result.score, ending: result.ending, reasons },
    wayIn,
    fullHref: a.kind === "oc" && b.kind === "oc" ? chemistryResultHref(sheetA, sheetB) : null,
  };
}

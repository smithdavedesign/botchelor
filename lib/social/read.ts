/**
 * The social network, read (docs/PRDs/social-network.md sections 8 and 9): one character's world, every tie between two
 * characters, and one lens of the public sky. What a page or the API may show, and never more:
 *
 *  - **Public:** active and ended ties marked public between listed characters (every derived tie is: it came from what
 *    aired), the people and memberships marked public. A tie touching a private character keeps the pair's existence
 *    only, as /graph masks an edge (lib/graph.ts maskEdge): one entry a pair, no kind, no layer and no tie id (the id is a
 *    hash of the kind). A private character keeps its name and id only. A character whose account was deleted, or a
 *    persona, vanishes with its ties.
 *  - **A viewer** (a person's id) who owns either end of a tie sees it unmasked, marked `owner`, or still proposed, and
 *    the owner of a character sees its people and memberships marked `owner`. `private` rows are the engine's, and a
 *    declined proposal is nobody's page: never here.
 *  - **Never:** the person columns (created_by, answered_by, an event's actor) or the model that wrote a row. A tie's or
 *    an event's `source_ref` shows only while that ref is still in the tie's evidence, so a date made private since
 *    doesn't linger in a history.
 *
 * Who shares a place (coworkers at the lighthouse, regulars at the dive bar, both from Leeds) is worked out here from
 * current, public memberships (`SHARED`), never stored as pairs. Every read is by index: a world is O(its degree) plus
 * its places' members (CO_MEMBERS_KEPT a place and role); the sky is its lens's strongest `limit` ties.
 * lib/social/cache.ts caches the public views for a minute under the Constellation's tag; `worldAccess` and
 * `pairAccess` say, live, when a viewer gets a build of their own instead.
 */
import type { Db } from "../db";
import { portraitPathSql } from "../portrait-sql";
import { DELETED_OWNER } from "../rules";
import { notPersonaSql } from "../step-in-shared";
import { rings, type RingTie } from "./algorithms";
import { isTieKind, TIE_KINDS } from "./kinds";
import { socialTiesOn } from "./switch";
import { TIE_COLUMNS, tieFromRow, type TieRow } from "./ties";
import {
  clampValence,
  LENS_LAYERS,
  SHARED_ROLES,
  type EgoNetwork,
  type Layer,
  type MaskedPair,
  type MembershipView,
  type PairTies,
  type PersonView,
  type PlaceKind,
  type PlaceRole,
  type PlaceView,
  type Ring,
  type SharedPlace,
  type SharedRole,
  type SkyLens,
  type SkyPlace,
  type SkyTie,
  type SocialNode,
  type SocialSky,
  type Source,
  type Tie,
  type TieEvent,
  type TieEventView,
  type TieKindId,
  type TieStatus,
  type TieView,
  type Visibility,
} from "./types";

type Env = Record<string, string | undefined>;

/** How many of a place's other members a world names, a place and role (the most recently active first). */
export const CO_MEMBERS_KEPT = 50;
/** The most changes a pair's history shows: the newest, oldest first. */
export const PAIR_EVENTS_KEPT = 100;
/** The sky's ties by default, and at most: its lens's strongest. */
export const SKY_LIMIT = 600;
export const SKY_LIMIT_MAX = 3000;
/** The most places the sky names, and the most members it lists a place (`count` has them all). */
export const SKY_PLACES = 60;
export const SKY_PLACE_MEMBERS = 100;

/**
 * Sharing a place, by role: the layer it counts on (the sky's lenses), how close it makes two characters and how far in
 * it can bring someone in a world (as the kind it's like: coworker, classmate, neighbour), and what the pair is called.
 */
export const SHARED: Record<SharedRole, { layer: Layer; closeness: number; ring: Ring; words: (place: string) => string }> = {
  works: { layer: "work", closeness: TIE_KINDS.coworker.closeness, ring: TIE_KINDS.coworker.ring, words: (p) => `Coworkers at ${p}` },
  studied: { layer: "work", closeness: TIE_KINDS.classmate.closeness, ring: TIE_KINDS.classmate.ring, words: (p) => `Studied at ${p}` },
  lives: { layer: "place", closeness: TIE_KINDS.neighbour.closeness, ring: TIE_KINDS.neighbour.ring, words: (p) => `Neighbours in ${p}` },
  regular: { layer: "place", closeness: 0.25, ring: "acquaintances", words: (p) => `Regulars at ${p}` },
  from: { layer: "place", closeness: 0.2, ring: "acquaintances", words: (p) => `Both from ${p}` },
};

/** Changes an event may hold that a page doesn't show: who (or what model) wrote the tie. */
const UNSHOWN_CHANGES = new Set(["origin_model", "prompt_version", "confidence"]);

/* ------------------------------------------------------ SQL ------------------------------------------------------ */

/** A character still listed: not a deleted account's and not a persona (lib/directory.ts's rule). Also Phase 4's suggestions' (lib/social/suggest.ts). */
export const listedSql = (c: string): string => `${c}.owner_id is distinct from '${DELETED_OWNER}' and ${notPersonaSql(c)}`;

/** A character's node columns, prefixed `as`; `mine` when `viewer` (a text SQL expression, maybe null) owns it. */
const nodeSql = (c: string, viewer: string, as = ""): string =>
  `${c}.id as ${as}id, ${c}.name as ${as}name, ${c}.visibility = 'private' as ${as}private, ${c}.avatar_hue as ${as}hue,
   ${portraitPathSql(c)} as ${as}portrait, coalesce(${c}.owner_id = ${viewer}, false) as ${as}mine`;

const rolesSql = (roles: readonly SharedRole[]): string => `'{${roles.join(",")}}'::text[]`;

/**
 * A membership that makes its character share its place (`SHARED`): current, public, of a public place, and not living
 * in the house (that's the `housemate` tie) or the whole city. Also Phase 4's suggestions' (lib/social/suggest.ts), where
 * a shared place is a reason to suggest someone.
 */
export const sharedSql = (m: string, p: string, roles: readonly SharedRole[] = SHARED_ROLES): string =>
  `${m}.role = any(${rolesSql(roles)}) and ${m}.ended_at is null and ${m}.visibility = 'public' and ${p}.visibility = 'public'
   and not (${m}.role = 'lives' and ${p}.kind in ('house', 'city'))`;

const T_COLUMNS = TIE_COLUMNS.split(",")
  .map((c) => `t.${c.trim()}`)
  .join(", ");

const PLACE_SQL = (p: string) => `${p}.key as place_key, ${p}.kind as place_kind, ${p}.name as place_name, ${p}.parent_id as place_parent,
  ${p}.venue_id as place_venue, ${p}.description as place_description`;

/* ----------------------------------------------------- rows ----------------------------------------------------- */

type NodeRow = { id: string; name: string; private: boolean; hue: number | null; portrait: string | null; mine: boolean };
type PlaceCols = { place_id: string; place_key: string; place_kind: string; place_name: string; place_parent: string | null; place_venue: string | null; place_description: string | null };
type PersonRow = Omit<PersonView, "visibility"> & { visibility: string };

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const iso = (v: string | Date | null | undefined): string | null => (v === null || v === undefined ? null : new Date(v).toISOString());
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const ordered = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

/** A private character keeps its name and id only, unless the viewer owns it (lib/graph.ts maskNode). */
const nodeOf = (r: NodeRow): SocialNode =>
  r.private && !r.mine ? { id: r.id, name: r.name, private: true, portrait: null, hue: null } : { id: r.id, name: r.name, private: r.private, portrait: r.portrait, hue: r.hue };

const placeOf = (r: PlaceCols): PlaceView => ({
  id: r.place_id,
  key: r.place_key,
  kind: r.place_kind as PlaceKind,
  name: r.place_name,
  parent_id: r.place_parent,
  venue_id: r.place_venue,
  description: r.place_description,
});

const personOf = (r: PersonRow): PersonView => ({
  id: r.id,
  holder_id: r.holder_id,
  name: r.name,
  pronouns: r.pronouns,
  note: r.note,
  deceased: r.deceased,
  visibility: r.visibility as Visibility,
  promoted_to: r.promoted_to,
});

const sharedOf = (x: string, y: string, place: PlaceView, role: SharedRole): SharedPlace => {
  const [a, b] = ordered(x, y);
  return { a, b, place_id: place.id, role, layer: SHARED[role].layer, words: SHARED[role].words(place.name) };
};

/** A tie as a page shows it: never the person columns or the model, its source_ref only while it's still evidence. */
export function tieView(t: Tie): TieView {
  return {
    id: t.id,
    from: t.from_id,
    to: t.to_id,
    to_person: t.to_person_id,
    kind: t.kind,
    layer: t.layer,
    directed: t.directed,
    valence: t.valence,
    closeness: t.closeness,
    status: t.status,
    visibility: t.visibility,
    source: t.source,
    source_ref: t.source_ref && t.evidence.some((e) => e.ref === t.source_ref) ? t.source_ref : null,
    evidence: t.evidence,
    detail: t.detail,
    story: t.story,
    since_text: t.since_text,
    started_at: t.started_at,
    ended_at: t.ended_at,
    last_contact_at: t.last_contact_at,
  };
}

/** A tie's end as `tieAccess` reads it: private or not, and whether the viewer owns it. */
type End = { private: boolean; mine: boolean };

/**
 * What a viewer may see of one tie, given its ends as read (undefined: not listed, or not there): all of it (`mine`
 * when only because the viewer owns an end), the pair's existence only, or nothing. `person` is the off-screen person a
 * tie to one goes to.
 */
function tieAccess(t: Pick<Tie, "kind" | "to_id" | "visibility" | "status">, from: End | undefined, to: End | undefined, person?: { visibility: string }): "show" | "mine" | "mask" | null {
  if (!isTieKind(t.kind) || t.visibility === "private" || t.status === "declined" || !from) return null;
  if (t.to_id ? !to : !person || person.visibility === "private") return null;
  const mine = from.mine || Boolean(to?.mine);
  const open = t.visibility === "public" && t.status !== "proposed" && !from.private && !to?.private && (!person || person.visibility === "public");
  if (open) return "show";
  if (mine) return "mine";
  // Not the viewer's: a public tie touching a private character is its pair's existence; a person's, nothing.
  return t.visibility === "public" && t.status !== "proposed" && t.to_id ? "mask" : null;
}

/* ---------------------------------------------------- access ---------------------------------------------------- */

/**
 * Who's asking about a world, read live (one statement) before any cache: null when the character isn't listed or
 * SOCIAL_TIES is off; `private` when it's private; `personal` when the viewer would see more than the public does
 * (they own it, or a character tied to it), so their build is their own and never cached.
 */
export async function worldAccess(db: Db, id: string, viewer: string | null, env: Env = process.env): Promise<{ private: boolean; personal: boolean } | null> {
  if (!socialTiesOn(env)) return null;
  const { rows } = await db.query<{ private: boolean; personal: boolean }>(
    `select c.visibility = 'private' as private,
            coalesce(c.owner_id = $2::text, false) or ($2::text is not null and exists (
              select 1 from social_ties t
                join characters o on o.id = case when t.from_id = c.id then t.to_id else t.from_id end
               where (t.from_id = c.id or t.to_id = c.id) and t.to_id is not null and t.visibility <> 'private'
                 and t.status <> 'declined' and o.owner_id = $2::text)) as personal
       from characters c
      where c.id = $1 and ${listedSql("c")}`,
    [id, viewer],
  );
  return rows[0] ?? null;
}

/**
 * The same for a pair: null when either isn't listed; `masked` when either is private (the public sees their existence
 * only, on the sky); `personal` when the viewer owns either.
 */
export async function pairAccess(db: Db, a: string, b: string, viewer: string | null, env: Env = process.env): Promise<{ masked: boolean; personal: boolean } | null> {
  if (!socialTiesOn(env) || a === b) return null;
  const { rows } = await db.query<{ private: boolean; mine: boolean }>(
    `select c.visibility = 'private' as private, coalesce(c.owner_id = $2::text, false) as mine from characters c where c.id = any($1::text[]) and ${listedSql("c")}`,
    [[a, b], viewer],
  );
  if (rows.length < 2) return null;
  return { masked: rows.some((r) => r.private), personal: rows.some((r) => r.mine) };
}

/* -------------------------------------------------- X's world -------------------------------------------------- */

type OtherCols = { o_id: string | null; o_name: string | null; o_private: boolean | null; o_hue: number | null; o_portrait: string | null; o_mine: boolean | null };
type MemberRow = PlaceCols & { role: string; since_text: string | null; started_at: string | Date | null; ended_at: string | Date | null; detail: unknown; visibility: string; place_visibility: string };
type CoMemberRow = NodeRow & PlaceCols & { role: string };

/**
 * "X's world": the character's ties to characters and to its people, strongest first; the pairs masked to existence;
 * its people, places and who shares them; and its rings (Dunbar, from the active ties and shared places). A private
 * character's world is its name and the existence of its public ties, unless the viewer owns it. Null when the
 * character isn't listed or SOCIAL_TIES is off.
 */
export async function egoNetwork(db: Db, id: string, o: { viewer?: string | null; env?: Env } = {}): Promise<EgoNetwork | null> {
  if (!socialTiesOn(o.env)) return null;
  const viewer = o.viewer ?? null;
  const [centreQ, tiesQ, peopleQ, membersQ, coQ] = await Promise.all([
    db.query<NodeRow>(`select ${nodeSql("c", "$2::text")} from characters c where c.id = $1 and ${listedSql("c")}`, [id, viewer]),
    db.query<TieRow & OtherCols>(
      `select ${T_COLUMNS}, ${nodeSql("o", "$2::text", "o_")}
         from social_ties t
         left join characters o on o.id = case when t.from_id = $1 then t.to_id else t.from_id end and ${listedSql("o")}
        where (t.from_id = $1 or t.to_id = $1) and t.visibility <> 'private' and t.status <> 'declined'
        order by t.closeness desc, t.id`,
      [id, viewer],
    ),
    db.query<PersonRow>(
      `select id, holder_id, name, pronouns, note, deceased, visibility, promoted_to from social_people
        where holder_id = $1 and visibility <> 'private' order by created_at, id`,
      [id],
    ),
    db.query<MemberRow>(
      `select m.place_id, m.role, m.since_text, m.started_at, m.ended_at, m.detail, m.visibility, p.visibility as place_visibility, ${PLACE_SQL("p")}
         from social_place_members m join social_places p on p.id = m.place_id
        where m.character_id = $1 and m.visibility <> 'private' and p.visibility <> 'private'
        order by m.started_at nulls last, p.name, m.role`,
      [id],
    ),
    db.query<CoMemberRow>(
      `with here as (
         select m.place_id, m.role from social_place_members m join social_places p on p.id = m.place_id
          where m.character_id = $1 and ${sharedSql("m", "p")}
       ), others as (
         select m.place_id, m.role, m.character_id,
                row_number() over (partition by m.place_id, m.role order by m.updated_at desc, m.character_id) as n
           from social_place_members m
           join here on here.place_id = m.place_id and here.role = m.role
           join characters c on c.id = m.character_id and ${listedSql("c")} and c.visibility = 'public'
          where m.character_id <> $1 and m.ended_at is null and m.visibility = 'public'
       )
       select x.place_id, x.role, ${nodeSql("c", "$2::text")}, ${PLACE_SQL("p")}
         from others x join characters c on c.id = x.character_id join social_places p on p.id = x.place_id
        where x.n <= $3
        order by x.place_id, x.role, x.n`,
      [id, viewer, CO_MEMBERS_KEPT],
    ),
  ]);
  const centre = centreQ.rows[0];
  if (!centre) return null;
  // A private character's world, to anyone but its owner: its name, and that its public ties exist.
  const open = !centre.private || centre.mine;

  const people = open ? peopleQ.rows.filter((p) => p.visibility === "public" || centre.mine) : [];
  const peopleById = new Map(people.map((p) => [p.id, p]));
  // Whether anything in it is there only because the viewer owns it (then it's theirs alone: never cached).
  let personal = centre.private && centre.mine;
  const nodes = new Map<string, NodeRow>();
  const ties: TieView[] = [];
  const masked = new Map<string, MaskedPair>();
  for (const r of tiesQ.rows) {
    const t = tieFromRow(r);
    const other: NodeRow | undefined = r.o_id
      ? { id: r.o_id, name: r.o_name ?? "", private: Boolean(r.o_private), hue: r.o_hue, portrait: r.o_portrait, mine: Boolean(r.o_mine) }
      : undefined;
    const [from, to] = t.from_id === id ? [centre, t.to_id ? other : undefined] : [other, centre];
    const access = tieAccess(t, from, to, t.to_person_id ? peopleById.get(t.to_person_id) : undefined);
    if (!access) continue;
    if (other) nodes.set(other.id, other);
    if (access === "mask") {
      const [a, b] = ordered(t.from_id, t.to_id!);
      masked.set(`${a}\u0000${b}`, { a, b, masked: true });
      continue;
    }
    if (access === "mine") personal = true;
    ties.push(tieView(t));
  }
  if (people.some((p) => p.visibility !== "public")) personal = true;

  const places = new Map<string, PlaceView>();
  const memberships: MembershipView[] = [];
  const shared: SharedPlace[] = [];
  if (open) {
    for (const m of membersQ.rows) {
      if (m.visibility !== "public" || m.place_visibility !== "public") {
        if (!centre.mine) continue;
        personal = true;
      }
      places.set(m.place_id, placeOf(m));
      memberships.push({
        place_id: m.place_id,
        role: m.role as PlaceRole,
        since_text: m.since_text,
        started_at: iso(m.started_at),
        ended_at: iso(m.ended_at),
        detail: isRecord(m.detail) ? m.detail : {},
        visibility: m.visibility as Visibility,
      });
    }
    for (const r of coQ.rows) {
      const place = placeOf(r);
      places.set(place.id, place);
      if (!nodes.has(r.id)) nodes.set(r.id, r);
      shared.push(sharedOf(id, r.id, place, r.role as SharedRole));
    }
  }

  const ringTies: RingTie[] = [];
  for (const t of ties) {
    const other = t.to_person ?? (t.from === id ? t.to : t.from);
    if (t.status === "active" && other) ringTies.push({ other, closeness: t.closeness, ring: TIE_KINDS[t.kind].ring });
  }
  for (const s of shared) ringTies.push({ other: s.a === id ? s.b : s.a, closeness: SHARED[s.role].closeness, ring: SHARED[s.role].ring });

  return {
    centre: nodeOf(centre),
    nodes: [...nodes.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)).map(nodeOf),
    ties,
    masked: [...masked.values()],
    people: people.map(personOf),
    memberships,
    places: [...places.values()],
    shared,
    rings: rings(ringTies),
    personal,
  };
}

/* ---------------------------------------------------- a pair ---------------------------------------------------- */

type SharedRow = PlaceCols & { role: string };

/**
 * Every tie between two characters, across layers and time ("Coworkers at the lighthouse · Exes · Rivals since
 * November"): the ties, their history (oldest first, the newest PAIR_EVENTS_KEPT changes), and the places they share.
 * Null when either isn't listed, when either is private and the viewer owns neither (the sky shows that pair's
 * existence only, as /api/graph/[a]/[b] is a 404 for it), or when there's nothing between them.
 */
export async function pairTies(db: Db, a: string, b: string, o: { viewer?: string | null; env?: Env } = {}): Promise<PairTies | null> {
  if (!socialTiesOn(o.env) || !a || !b || a === b) return null;
  const [lo, hi] = ordered(a, b);
  const viewer = o.viewer ?? null;
  const [nodesQ, tiesQ, sharedQ] = await Promise.all([
    db.query<NodeRow>(`select ${nodeSql("c", "$2::text")} from characters c where c.id = any($1::text[]) and ${listedSql("c")}`, [[lo, hi], viewer]),
    db.query<TieRow>(
      `select ${TIE_COLUMNS} from social_ties
        where ((from_id = $1 and to_id = $2) or (from_id = $2 and to_id = $1)) and visibility <> 'private' and status <> 'declined'
        order by closeness desc, id`,
      [lo, hi],
    ),
    db.query<SharedRow>(
      `select m.place_id, m.role, ${PLACE_SQL("p")}
         from social_place_members m
         join social_places p on p.id = m.place_id
         join social_place_members n on n.place_id = m.place_id and n.role = m.role and n.character_id = $2 and n.ended_at is null and n.visibility = 'public'
        where m.character_id = $1 and ${sharedSql("m", "p")}
        order by p.name, m.role`,
      [lo, hi],
    ),
  ]);
  const byId = new Map(nodesQ.rows.map((r) => [r.id, r]));
  const [na, nb] = [byId.get(lo), byId.get(hi)];
  if (!na || !nb) return null;
  if ((na.private || nb.private) && !na.mine && !nb.mine) return null;
  const seen = tiesQ.rows.map((r) => {
    const t = tieFromRow(r);
    return { t, access: tieAccess(t, byId.get(t.from_id), t.to_id ? byId.get(t.to_id) : undefined) };
  });
  const ties = seen.filter((x) => x.access === "show" || x.access === "mine").map((x) => x.t);
  const personal = seen.some((x) => x.access === "mine");
  const places = sharedQ.rows.map((r) => ({ place: placeOf(r), role: r.role as SharedRole }));
  if (!ties.length && !places.length) return null;
  return {
    a: nodeOf(na),
    b: nodeOf(nb),
    ties: ties.map(tieView),
    events: await eventsOf(db, ties),
    shared: places.map((p) => sharedOf(lo, hi, p.place, p.role)),
    places: [...new Map(places.map((p) => [p.place.id, p.place])).values()],
    personal,
  };
}

/** The ties' history, oldest first: the newest `kept` changes, never who made them, a ref only while it's evidence. */
async function eventsOf(db: Db, ties: readonly Tie[], kept = PAIR_EVENTS_KEPT): Promise<TieEventView[]> {
  if (!ties.length) return [];
  const byId = new Map(ties.map((t) => [t.id, { kind: t.kind, refs: new Set(t.evidence.map((e) => e.ref)) }]));
  const { rows } = await db.query<{ tie_id: string; event: string; changes: unknown; source: string | null; source_ref: string | null; at: string | Date }>(
    `select tie_id, event, changes, source, source_ref, at from social_tie_events where tie_id = any($1::text[]) order by at desc, id desc limit $2`,
    [[...byId.keys()], kept],
  );
  return rows.reverse().map((r) => {
    const tie = byId.get(r.tie_id)!;
    const changes = Object.fromEntries(Object.entries(isRecord(r.changes) ? r.changes : {}).filter(([k]) => !UNSHOWN_CHANGES.has(k))) as Record<string, [unknown, unknown]>;
    return {
      tie_id: r.tie_id,
      kind: tie.kind,
      event: r.event as TieEvent,
      changes,
      source: r.source as Source | null,
      source_ref: r.source_ref && tie.refs.has(r.source_ref) ? r.source_ref : null,
      at: new Date(r.at).toISOString(),
    };
  });
}

/* ---------------------------------------------------- the sky ---------------------------------------------------- */

type SkyRow = { from_id: string; to_id: string; kind: string; layer: string; directed: boolean; valence: number; closeness: number; status: string; detail: unknown; last_contact_at: string | Date | null };
type SkyPlaceRow = PlaceCols & { role: string; count: number; members: string[] };

/**
 * One lens of the public sky (PRD section 9): its strongest `limit` public ties between public characters (people's
 * ties aren't on the sky), the places two or more of the public cast share (friends and all: as groups, never pairs),
 * the pairs masked to existence (on `all` only: a lens would tell their layer), and counts over the whole lens for
 * its numbers line. Null when SOCIAL_TIES is off.
 */
export async function publicSky(db: Db, lens: SkyLens, o: { limit?: number; env?: Env } = {}): Promise<SocialSky | null> {
  if (!socialTiesOn(o.env) || !LENS_LAYERS[lens]) return null;
  const layers = [...LENS_LAYERS[lens]];
  const limit = Math.max(1, Math.min(SKY_LIMIT_MAX, Math.floor(o.limit ?? SKY_LIMIT) || SKY_LIMIT));
  const roles = SHARED_ROLES.filter((r) => layers.includes(SHARED[r].layer));
  const lensSql = `t.to_id is not null and t.visibility = 'public' and t.status in ('active', 'ended') and t.layer = any($1::text[])`;
  const bothSql = `join characters ca on ca.id = t.from_id and ${listedSql("ca")} join characters cb on cb.id = t.to_id and ${listedSql("cb")}`;
  const publicSql = `ca.visibility = 'public' and cb.visibility = 'public'`;
  const [tiesQ, statsQ, maskedQ, placesQ] = await Promise.all([
    db.query<SkyRow>(
      `select t.from_id, t.to_id, t.kind, t.layer, t.directed, t.valence, t.closeness, t.status, t.detail, t.last_contact_at
         from social_ties t ${bothSql}
        where ${lensSql} and ${publicSql}
        order by t.closeness desc, t.last_contact_at desc nulls last, t.id
        limit $2`,
      [layers, limit],
    ),
    db.query<{ kind: string; status: string; n: number }>(
      `select t.kind, t.status, count(*)::int as n from social_ties t ${bothSql} where ${lensSql} and ${publicSql} group by t.kind, t.status`,
      [layers],
    ),
    lens === "all"
      ? db.query<{ lo: string; hi: string }>(
          `select distinct least(t.from_id, t.to_id) as lo, greatest(t.from_id, t.to_id) as hi
             from social_ties t ${bothSql}
            where ${lensSql} and not (${publicSql})
            order by lo, hi
            limit $2`,
          [layers, limit],
        )
      : null,
    roles.length
      ? db.query<SkyPlaceRow>(
          `select m.place_id, m.role, count(*)::int as count,
                  (array_agg(m.character_id order by m.updated_at desc, m.character_id))[1:$1::int] as members, ${PLACE_SQL("p")}
             from social_place_members m
             join social_places p on p.id = m.place_id
             join characters c on c.id = m.character_id and ${listedSql("c")} and c.visibility = 'public'
            where ${sharedSql("m", "p", roles)}
            group by m.place_id, m.role, p.key, p.kind, p.name, p.parent_id, p.venue_id, p.description
           having count(*) >= 2
            order by count(*) desc, p.name, m.role
            limit $2`,
          [SKY_PLACE_MEMBERS, SKY_PLACES],
        )
      : null,
  ]);

  const ties: SkyTie[] = tiesQ.rows
    .filter((r) => isTieKind(r.kind))
    .map((r) => ({
      from: r.from_id,
      to: r.to_id,
      kind: r.kind as TieKindId,
      layer: r.layer as Layer,
      directed: r.directed,
      valence: clampValence(Number(r.valence)),
      closeness: round3(Number(r.closeness)),
      status: r.status as TieStatus,
      detail: isRecord(r.detail) ? r.detail : {},
      last_contact_at: iso(r.last_contact_at),
    }));
  const masked: MaskedPair[] = (maskedQ?.rows ?? []).map((r) => ({ a: r.lo, b: r.hi, masked: true }));
  const places: SkyPlace[] = (placesQ?.rows ?? []).map((r) => {
    const place = placeOf(r);
    const role = r.role as SharedRole;
    return { ...place, role, words: SHARED[role].words(place.name), count: r.count, members: r.members };
  });

  const ids = new Set<string>();
  for (const t of ties) ids.add(t.from).add(t.to);
  for (const m of masked) ids.add(m.a).add(m.b);
  for (const p of places) for (const m of p.members) ids.add(m);
  const nodeRows = ids.size
    ? (await db.query<NodeRow>(`select ${nodeSql("c", "null::text")} from characters c where c.id = any($1::text[]) and ${listedSql("c")} order by c.name, c.id`, [[...ids]])).rows
    : [];

  const byKind: SocialSky["stats"]["byKind"] = {};
  let total = 0;
  for (const r of statsQ.rows) {
    if (!isTieKind(r.kind) || (r.status !== "active" && r.status !== "ended")) continue;
    const k = (byKind[r.kind] ??= { active: 0, ended: 0 });
    k[r.status as "active" | "ended"] += r.n;
    total += r.n;
  }
  return { lens, layers, nodes: nodeRows.map(nodeOf), ties, masked, places, stats: { ties: total, shown: ties.length, byKind } };
}

/**
 * The show writes circles (docs/PRDs/social-network.md section 6.2): each of its own characters gets off-screen people,
 * places in the shared world and a few ties to other show characters, so the cast is a web and not a row of isolated
 * stars. Two writers use this:
 *
 *  - the season generator (lib/season-gen.ts), in the call it already makes for a newcomer;
 *  - scripts/social/backfill-circles.mjs, for the characters the show already has, on the Mac's free local model,
 *    through POST /api/admin/social/circles.
 *
 * The show's own characters are its house characters (the season's cast and candidates among them) and its own
 * agent-made cast (made over MCP by our own agents: lib/our-traffic.ts, as lib/adult/agent-cast.ts decides), public and
 * listed, never a test character and never a person's: a person's character on the cast (lib/auditions.ts) gets its
 * circle from its owner. Every item is checked before anything is written: a kind from the registry that the show may
 * declare, a name, note, story and place name that pass the show's text check (checkShowText), the caps (people a
 * character, the exclusive kinds), a place of the right kind for the role, a tie to another show character only, and no
 * kin tie between two who have dated (nor a romance between kin). What fails is refused alone; the rest is written, with
 * `source` house (or admin), `origin_model` and `prompt_version`, public.
 */
import type { Db } from "../db";
import { franchiseHits } from "../franchises";
import { ALL_HOUSE_CHARACTERS } from "../house";
import { loadOurIds, OUR_TEST_NAMES, TEST_NAME_SQL } from "../our-traffic";
import { DELETED_OWNER } from "../rules";
import { checkShowText } from "../safety";
import { seasonCastIds } from "../season-cast";
import { notPersonaSql } from "../step-in-shared";
import { DATE_VENUES } from "../venues";
import { TIE_KINDS, type TieKindId } from "./kinds";
import { addPerson, checkPerson, peopleOf, updatePerson } from "./people";
import { ensurePlace, PLACE_DESCRIPTION_MAX, PLACE_NAME_MAX, MEMBER_SINCE_MAX, placeIdOf, setMembership, slugify, venueKey } from "./places";
import { canonicalTie, isDeclaredRole, kindFromWords, mayDeclarePerson, mayDeclareTie, NEW_PLACE_FOR, ROLE_PLACES, tieFromWords, type DeclaredRole } from "./relations";
import { socialTiesOn } from "./switch";
import { SINCE_MAX, STORY_MAX, upsertTie } from "./ties";
import { ensureWorld, NEIGHBOURHOODS, neighbourhoodOfVenue, WORLD_CITY } from "./world";
import { PEOPLE_CAP, type PlaceKind } from "./types";

type Env = Record<string, string | undefined>;

/** The most of each one circle write takes for a character (the people cap, PEOPLE_CAP, holds over every write). */
export const CIRCLE_LIMITS = { people: 8, places: 6, ties: 4 } as const;

/**
 * The show's characters are single (they're on a dating show): the show never gives one a partner, a spouse, a fiancé or
 * a situationship, with another character or off-screen. A late spouse or partner is a person it may name (deceased).
 */
export const TAKEN_KINDS: ReadonlySet<TieKindId> = new Set<TieKindId>(["spouse", "partner", "engaged", "situationship"]);

/** One off-screen person, as a writer gives them: `relation` is a kind's id or words ("older sister", "boss"). */
export type CirclePersonIn = { name: string; relation: string; pronouns?: string | null; note?: string | null; deceased?: boolean; story?: string | null; since?: string | null };
/**
 * One place: a role (lives, works, regular, studied) and the place, by key (`neighbourhood:old-town`, `venue:dive_bar`)
 * or by name; a workplace or school no one has named yet is made, in `neighbourhood` (a key or a name; the city
 * when none).
 */
export type CirclePlaceIn = { role: string; place?: string | null; name?: string | null; neighbourhood?: string | null; description?: string | null; since?: string | null };
/** One tie to another show character (`with`, an id): `relation` reads "they are this character's <relation>". */
export type CircleTieIn = { with: string; relation: string; reversed?: boolean; story?: string | null; since?: string | null };
export type CircleIn = { character_id: string; people?: CirclePersonIn[]; places?: CirclePlaceIn[]; ties?: CircleTieIn[] };

export type CircleOptions = {
  source: "house" | "admin";
  /** The model that wrote it (a dataset filters by writer), and its prompt's version. */
  origin_model: string | null;
  prompt_version: string | null;
  /** Write even when the character already has the show's circle: the show's earlier people and places for it go first. */
  replace?: boolean;
  /** Check everything and write nothing (the backfill's --dry-run). */
  dryRun?: boolean;
  /** Who did it, for the tie log: an admin's id, or "system". */
  actor?: string | null;
  env?: Env;
};

export type CircleRefusal = { item: "character" | "person" | "place" | "tie"; what: string; reason: string };
export type CircleResult = {
  character_id: string;
  /** written; checked (a dry run that would write); skipped (it has the show's circle already); refused (not the show's). */
  status: "written" | "checked" | "skipped" | "refused";
  reason?: string;
  people: number;
  places: number;
  ties: number;
  refused: CircleRefusal[];
};

/* ---------------------------------------------- the show's characters ---------------------------------------------- */

/** How the show has a character: on this season's cast, another house character, or its own agent-made cast. */
export type ShowKind = "cast" | "house" | "agent";

/**
 * Which of these characters are the show's own (all of them when `ids` is null), and how. One read, plus our ids
 * (lib/our-traffic.ts loadOurIds) when `ours` isn't given.
 */
export async function showCharacterIds(db: Db, ids: readonly string[] | null, o: { ours?: readonly string[]; now?: Date } = {}): Promise<Map<string, ShowKind>> {
  if (ids && !ids.length) return new Map();
  const ours = o.ours ?? (await loadOurIds(db));
  const { rows } = await db.query<{ id: string; is_house: boolean }>(
    `select c.id, c.is_house from characters c
      where ($1::text[] is null or c.id = any($1::text[]))
        and (c.is_house or (c.created_via = 'mcp' and c.owner_id = any($2::text[]) and c.owner_id <> $3))
        and c.visibility = 'public' and ${notPersonaSql("c")}
        and not (c.name = any($4::text[]) or c.name ~* $5)`,
    [ids ? [...new Set(ids)] : null, [...ours], DELETED_OWNER, [...OUR_TEST_NAMES], TEST_NAME_SQL],
  );
  const cast = new Set(seasonCastIds(o.now ?? new Date()));
  return new Map(rows.map((r) => [r.id, r.is_house ? (cast.has(r.id) ? "cast" : "house") : "agent"]));
}

/**
 * Our own identities (lib/our-traffic.ts loadOurIds) for showCharacterIds' `ours`, kept a minute per database: a wide
 * read, so an owner's search as they type, a page or a few writes (lib/social/declare.ts, suggest.ts) read it once.
 */
const OURS_MS = 60_000;
const oursCache = new WeakMap<Db, { at: number; ids: Promise<string[]> }>();
export function ourIdsCached(db: Db): Promise<string[]> {
  const hit = oursCache.get(db);
  if (hit && Date.now() - hit.at < OURS_MS) return hit.ids;
  const ids = loadOurIds(db);
  oursCache.set(db, { at: Date.now(), ids });
  ids.catch(() => oursCache.delete(db));
  return ids;
}

/** SQL: whether character `c` has the show's circle already (people or places the show wrote for it). */
const hasCircleSql = (c: string): string =>
  `(exists (select 1 from social_people p where p.holder_id = ${c}.id and p.source in ('house', 'admin'))
    or exists (select 1 from social_place_members m where m.character_id = ${c}.id and m.source in ('house', 'admin')))`;

/** Whether the show has written this character's circle already. */
export async function hasCircle(db: Db, characterId: string): Promise<boolean> {
  const { rows } = await db.query<{ has: boolean }>(`select ${hasCircleSql("c")} as has from characters c where c.id = $1`, [characterId]);
  return rows[0]?.has === true;
}

/** A show character as the backfill's model reads them: who they are, what they do, where they're from, and whom they've dated. */
export type ShowCharacter = {
  id: string;
  name: string;
  kind: ShowKind;
  age: number | null;
  pronouns: string | null;
  bio: string;
  archetype: string | null;
  occupation: string | null;
  hometown: string | null;
  voice: string | null;
  traits: string[];
  has_circle: boolean;
  /** Characters they've been on a date with: never their family. */
  dated: string[];
};

/** The show's characters, a page at a time by id (after `after`), each with what the backfill's prompt needs. */
export async function showCharacters(db: Db, o: { after?: string; limit?: number; ours?: readonly string[]; now?: Date } = {}): Promise<ShowCharacter[]> {
  const kinds = await showCharacterIds(db, null, o);
  const ids = [...kinds.keys()].filter((id) => id > (o.after ?? "")).sort().slice(0, Math.max(1, Math.min(500, o.limit ?? 200)));
  if (!ids.length) return [];
  const [chars, dated] = await Promise.all([
    db.query<{ id: string; name: string; age: number | null; pronouns: string | null; bio: string; voice: string | null; traits: unknown; extras: Record<string, unknown> | null; archetype: string | null; has: boolean }>(
      `select c.id, c.name, c.age, c.pronouns, c.bio, c.voice, c.traits, c.extras, sc.archetype, ${hasCircleSql("c")} as has
         from characters c left join season_candidates sc on sc.character_id = c.id
        where c.id = any($1::text[]) order by c.id`,
      [ids],
    ),
    db.query<{ a: string; b: string }>(`select character_a as a, character_b as b from relationships where character_a = any($1::text[]) or character_b = any($1::text[])`, [ids]),
  ]);
  const datedOf = new Map<string, string[]>();
  for (const r of dated.rows) {
    datedOf.set(r.a, [...(datedOf.get(r.a) ?? []), r.b]);
    datedOf.set(r.b, [...(datedOf.get(r.b) ?? []), r.a]);
  }
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return chars.rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: kinds.get(r.id)!,
    age: r.age,
    pronouns: r.pronouns,
    bio: r.bio,
    archetype: r.archetype ?? ALL_HOUSE_CHARACTERS.find((h) => h.id === r.id)?.archetype ?? text(r.extras?.archetype),
    occupation: text(r.extras?.occupation),
    hometown: text(r.extras?.hometown),
    voice: r.voice,
    traits: Array.isArray(r.traits) ? r.traits.filter((x): x is string => typeof x === "string") : [],
    has_circle: r.has,
    dated: datedOf.get(r.id) ?? [],
  }));
}

/**
 * What a character's circle holds so far, as a writer reads it from the character's side: their public people ("Rosa,
 * parent") and their public ties to other characters ("Mira is my sibling", "Sam: dated"), declared ones first.
 */
export type CircleSummary = { people: { name: string; relation: string }[]; ties: { with: string; kind: TieKindId; relation: string }[] };

/** Each character's circle so far (at most 12 people and 12 ties each), for a writer to keep consistent with. */
export async function circleSummaries(db: Db, ids: readonly string[]): Promise<Map<string, CircleSummary>> {
  const out = new Map<string, CircleSummary>(ids.map((id) => [id, { people: [], ties: [] }]));
  if (!ids.length) return out;
  const [people, ties] = await Promise.all([
    db.query<{ holder_id: string; name: string; kind: string }>(
      `select p.holder_id, p.name, t.kind from social_people p join social_ties t on t.to_person_id = p.id and t.from_id = p.holder_id
        where p.holder_id = any($1::text[]) and p.visibility = 'public' and t.visibility = 'public' and t.status = 'active'
        order by p.created_at, p.id`,
      [ids],
    ),
    db.query<{ from_id: string; to_id: string; kind: string }>(
      `select from_id, to_id, kind from social_ties
        where to_id is not null and (from_id = any($1::text[]) or to_id = any($1::text[])) and visibility = 'public' and status in ('active', 'proposed')
        order by (source = 'derived'), closeness desc, id`,
      [ids],
    ),
  ]);
  for (const r of people.rows) {
    const s = out.get(r.holder_id);
    const k = TIE_KINDS[r.kind as TieKindId];
    if (s && k && s.people.length < 12) s.people.push({ name: r.name, relation: k.words.to });
  }
  for (const r of ties.rows) {
    const k = TIE_KINDS[r.kind as TieKindId];
    if (!k) continue;
    // "to is from's <kind>": from `from`'s side the other is its words.to; from `to`'s side, its words.from.
    for (const [me, other, relation] of [[r.from_id, r.to_id, k.words.to], [r.to_id, r.from_id, k.words.from]] as const) {
      const s = out.get(me);
      if (s && s.ties.length < 12) s.ties.push({ with: other, kind: r.kind as TieKindId, relation });
    }
  }
  return out;
}

/** The shared world as a writer picks from it: the city's neighbourhoods, its hangouts, and the workplaces and schools the show has named. */
export type WorldMenu = {
  city: { key: string; name: string };
  neighbourhoods: { key: string; name: string; description: string }[];
  hangouts: { key: string; name: string; neighbourhood: string }[];
  workplaces: { key: string; name: string; kind: PlaceKind; neighbourhood: string | null }[];
};

/** The world's menu (the show's own places only: a place a person named stays theirs to share). */
export async function worldMenu(db: Db, env: Env = process.env): Promise<WorldMenu> {
  await ensureWorld(db, env);
  const { rows } = await db.query<{ key: string; name: string; kind: string; parent: string | null }>(
    `select p.key, p.name, p.kind, n.name as parent from social_places p left join social_places n on n.id = p.parent_id
      where p.kind in ('workplace', 'school') and p.source in ('house', 'admin') and p.visibility = 'public'
      order by p.created_at, p.key limit 300`,
  );
  return {
    city: { key: WORLD_CITY.key, name: WORLD_CITY.name },
    neighbourhoods: NEIGHBOURHOODS.map((n) => ({ key: n.key, name: n.name, description: n.description })),
    hangouts: DATE_VENUES.flatMap((v) => {
      const n = neighbourhoodOfVenue(v.id);
      return n ? [{ key: venueKey(v.id), name: v.name, neighbourhood: n.name }] : [];
    }),
    workplaces: rows.map((r) => ({ key: r.key, name: r.name, kind: r.kind as PlaceKind, neighbourhood: r.parent })),
  };
}

/* --------------------------------------------------- the checks --------------------------------------------------- */

const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const lower = (s: string): string => clean(s).toLowerCase();

/** A story and a "since" as a tie keeps them, or why not (too long, or the show's text check). */
function tieWords(story: string | null | undefined, since: string | null | undefined): { ok: true; story: string | null; since: string | null } | { ok: false; reason: string } {
  const s = clean(story);
  const n = clean(since);
  if (s.length > STORY_MAX || n.length > SINCE_MAX) return { ok: false, reason: "too_long" };
  const fields: Record<string, string> = {};
  if (s) fields.story = s;
  if (n) fields.since = n;
  if (Object.keys(fields).length) {
    const check = checkShowText(fields);
    if (!check.ok) return { ok: false, reason: `unsafe: ${check.reason}` };
  }
  return { ok: true, story: s || null, since: n || null };
}

/** Originals only (lib/franchises.ts): the franchise these words read like, as a refusal, or null. */
function copied(fields: Record<string, string | null | undefined>): string | null {
  const hit = franchiseHits(fields)[0];
  return hit ? `not an original: "${hit.matched}" reads like ${hit.franchise}` : null;
}

/**
 * The pairs among these that have dated (a relationships row), have a romance tie or a romantic backstory (an ex or a
 * fake couple in character_links, whose tie may not be derived yet), and those with a kin tie.
 */
export async function pairHistory(db: Db, pairs: readonly [string, string][]): Promise<{ romance: Set<string>; kin: Set<string> }> {
  const romance = new Set<string>();
  const kin = new Set<string>();
  if (!pairs.length) return { romance, kin };
  const los = pairs.map(([a, b]) => (a < b ? a : b));
  const his = pairs.map(([a, b]) => (a < b ? b : a));
  const { rows } = await db.query<{ lo: string; hi: string; what: string }>(
    `select r.character_a as lo, r.character_b as hi, 'romance' as what
       from relationships r join unnest($1::text[], $2::text[]) as p(lo, hi) on r.character_a = p.lo and r.character_b = p.hi
     union
     select l.character_a, l.character_b, 'romance'
       from character_links l join unnest($1::text[], $2::text[]) as p(lo, hi) on l.character_a = p.lo and l.character_b = p.hi
      where l.kind in ('second_chance', 'fake_dating')
     union
     select least(t.from_id, t.to_id), greatest(t.from_id, t.to_id), t.layer
       from social_ties t join unnest($1::text[], $2::text[]) as p(lo, hi)
         on least(t.from_id, t.to_id) = p.lo and greatest(t.from_id, t.to_id) = p.hi
      where t.to_id is not null and t.status in ('active', 'proposed') and t.layer in ('romance', 'kin')`,
    [los, his],
  );
  for (const r of rows) (r.what === "kin" ? kin : romance).add(`${r.lo}|${r.hi}`);
  return { romance, kin };
}

/** Why a tie of this kind can't join this pair's history: kin between two who've dated, or romance between kin. */
export function pairClash(kind: TieKindId, pair: string, history: { romance: ReadonlySet<string>; kin: ReadonlySet<string> }): string | null {
  const layer = TIE_KINDS[kind].layer;
  if (layer === "kin" && history.romance.has(pair)) return "they've dated: never family";
  if (layer === "romance" && history.kin.has(pair)) return "they're family";
  return null;
}

type PlannedPerson = { name: string; kind: TieKindId; pronouns: string | null; note: string | null; deceased: boolean; story: string | null; since: string | null };
type PlannedPlace = { role: DeclaredRole; placeId: string; label: string; make: { key: string; kind: PlaceKind; name: string; parentKey: string; description: string | null } | null; since: string | null };
type PlannedTie = { from: string; to: string; kind: TieKindId; story: string | null; since: string | null; label: string };
type Plan = { people: PlannedPerson[]; places: PlannedPlace[]; ties: PlannedTie[]; refused: CircleRefusal[] };

type PlaceRow = { id: string; key: string; kind: string; name: string; visibility: string };

/**
 * The keys a place may be given by: its own key (`venue:dive_bar`), or a bare word that's a venue's id ("dive_bar"),
 * or a neighbourhood's, workplace's or school's slug.
 */
function keysFor(w: string): string[] {
  const t = w.toLowerCase();
  if (t.includes(":")) return [t];
  const slug = slugify(t);
  return [`venue:${t.replace(/[\s-]+/g, "_")}`, ...(slug ? [`neighbourhood:${slug}`, `workplace:${slug}`, `school:${slug}`] : [])];
}

/** A neighbourhood of the city by key or name. */
function neighbourhoodOf(text: string | null | undefined): (typeof NEIGHBOURHOODS)[number] | null {
  const t = lower(text ?? "");
  if (!t) return null;
  return NEIGHBOURHOODS.find((n) => n.key === t || lower(n.name) === t || lower(n.name).replace(/^the /, "") === t.replace(/^the /, "")) ?? null;
}

/**
 * Checks a circle against the registry, the caps and the show's rules, reading what it needs (the places it names,
 * the other show characters, the pairs' history, the people the character already has). Writes nothing.
 */
async function planCircle(db: Db, input: CircleIn, o: CircleOptions, show: ReadonlyMap<string, ShowKind>): Promise<Plan> {
  const refused: CircleRefusal[] = [];
  const me = input.character_id;
  const by = o.source;

  // People: a name and relation the registry and the text check take; each name once.
  const people: PlannedPerson[] = [];
  const personNames = new Set<string>();
  for (const p of (input.people ?? []).slice(0, CIRCLE_LIMITS.people)) {
    const what = clean(p.name) || "(no name)";
    const kind = kindFromWords(p.relation);
    if (!kind || !mayDeclarePerson(kind, by)) {
      refused.push({ item: "person", what, reason: `not a relation: ${clean(p.relation) || "none"}` });
      continue;
    }
    if (TAKEN_KINDS.has(kind) && p.deceased !== true) {
      refused.push({ item: "person", what, reason: "they're single: on the show to date" });
      continue;
    }
    const checked = checkPerson({ name: p.name ?? "", pronouns: p.pronouns ?? null, note: p.note ?? null });
    if (!checked.ok) {
      refused.push({ item: "person", what, reason: checked.reason });
      continue;
    }
    const words = tieWords(p.story, p.since);
    if (!words.ok) {
      refused.push({ item: "person", what, reason: words.reason });
      continue;
    }
    const copy = copied({ name: checked.name, note: checked.note, story: words.story });
    if (copy) {
      refused.push({ item: "person", what, reason: copy });
      continue;
    }
    if (personNames.has(lower(checked.name!))) {
      refused.push({ item: "person", what, reason: "named twice" });
      continue;
    }
    personNames.add(lower(checked.name!));
    people.push({ name: checked.name!, kind, pronouns: checked.pronouns ?? null, note: checked.note ?? null, deceased: p.deceased === true, story: words.story, since: words.since });
  }
  for (const p of (input.people ?? []).slice(CIRCLE_LIMITS.people)) refused.push({ item: "person", what: clean(p.name), reason: `more than ${CIRCLE_LIMITS.people} in one write` });

  // Places: by key, or by name among the places a role can be at; a workplace or school no one has named is made.
  const placesIn = (input.places ?? []).slice(0, CIRCLE_LIMITS.places);
  const wantedOf = (p: CirclePlaceIn): string[] => [clean(p.place), clean(p.name)].filter(Boolean);
  const keys = placesIn.flatMap((p) => wantedOf(p).flatMap(keysFor));
  const names = placesIn.flatMap((p) => wantedOf(p).map((w) => w.toLowerCase()));
  const known = keys.length
    ? (await db.query<PlaceRow>(`select id, key, kind, name, visibility from social_places where key = any($1::text[]) or lower(name) = any($2::text[])`, [keys, names])).rows.filter(
        (r) => r.visibility === "public",
      )
    : [];
  const places: PlannedPlace[] = [];
  const seenPlaces = new Set<string>();
  for (const p of placesIn) {
    const what = `${clean(p.role)} ${clean(p.place) || clean(p.name)}`.trim();
    if (!isDeclaredRole(p.role)) {
      refused.push({ item: "place", what, reason: `not a role: ${clean(p.role) || "none"}` });
      continue;
    }
    const role = p.role;
    const allowed = ROLE_PLACES[role];
    const wanted = wantedOf(p);
    const wantedKeys = new Set(wanted.flatMap(keysFor));
    const wantedNames = new Set(wanted.map((w) => w.toLowerCase()));
    // A neighbourhood named for "lives" may come as its key, its name, or "the front" for "The Front".
    const hood = role === "lives" ? wanted.map(neighbourhoodOf).find(Boolean) : null;
    const found =
      (hood ? known.find((k) => k.key === hood.key) : null) ??
      known.find((k) => allowed.includes(k.kind as PlaceKind) && (wantedKeys.has(k.key) || wantedNames.has(k.name.toLowerCase())));
    const since = clean(p.since).slice(0, MEMBER_SINCE_MAX) || null;
    if (since && !checkShowText({ since }).ok) {
      refused.push({ item: "place", what, reason: "unsafe" });
      continue;
    }
    let planned: PlannedPlace | null = null;
    if (found) planned = { role, placeId: found.id, label: found.name, make: null, since };
    else if (hood) planned = { role, placeId: placeIdOf(hood.key), label: hood.name, make: null, since };
    else {
      const kind = NEW_PLACE_FOR[role];
      const name = clean(p.name) || (p.place && !p.place.includes(":") ? clean(p.place) : "");
      if (!kind || !name) {
        refused.push({ item: "place", what, reason: role === "lives" ? "not one of the city's neighbourhoods" : "no such place in the world" });
        continue;
      }
      const description = clean(p.description).slice(0, PLACE_DESCRIPTION_MAX) || null;
      if (name.length > PLACE_NAME_MAX) {
        refused.push({ item: "place", what, reason: "too_long" });
        continue;
      }
      const check = checkShowText({ name, ...(description ? { description } : {}) });
      if (!check.ok) {
        refused.push({ item: "place", what, reason: `unsafe: ${check.reason}` });
        continue;
      }
      const copy = copied({ name, description });
      if (copy) {
        refused.push({ item: "place", what, reason: copy });
        continue;
      }
      const slug = slugify(name);
      if (!slug) {
        refused.push({ item: "place", what, reason: "no name" });
        continue;
      }
      const key = `${kind}:${slug}`;
      const parent = neighbourhoodOf(p.neighbourhood);
      planned = { role, placeId: placeIdOf(key), label: name, make: { key, kind, name, parentKey: parent?.key ?? WORLD_CITY.key, description }, since };
    }
    const k = `${planned.placeId}|${role}`;
    if (seenPlaces.has(k)) continue;
    seenPlaces.add(k);
    places.push(planned);
  }
  for (const p of (input.places ?? []).slice(CIRCLE_LIMITS.places)) refused.push({ item: "place", what: clean(p.name) || clean(p.place), reason: `more than ${CIRCLE_LIMITS.places} in one write` });

  // Ties: to another show character, a kind the show may declare, never kin with someone they've dated.
  const tiesIn = (input.ties ?? []).slice(0, CIRCLE_LIMITS.ties);
  const candidates: PlannedTie[] = [];
  for (const t of tiesIn) {
    const what = `${clean(t.relation)} ${clean(t.with)}`.trim();
    const read = tieFromWords(t.relation);
    const kind = read?.kind ?? null;
    if (!t.with || t.with === me) {
      refused.push({ item: "tie", what, reason: "not another character" });
      continue;
    }
    if (!show.has(t.with)) {
      refused.push({ item: "tie", what, reason: "not one of the show's own characters" });
      continue;
    }
    if (!kind || !mayDeclareTie(kind, by, { own: true })) {
      refused.push({ item: "tie", what, reason: `not a relation: ${clean(t.relation) || "none"}` });
      continue;
    }
    if (TAKEN_KINDS.has(kind)) {
      refused.push({ item: "tie", what, reason: "they're single: on the show to date" });
      continue;
    }
    const words = tieWords(t.story, t.since);
    if (!words.ok) {
      refused.push({ item: "tie", what, reason: words.reason });
      continue;
    }
    const copy = copied({ story: words.story });
    if (copy) {
      refused.push({ item: "tie", what, reason: copy });
      continue;
    }
    // "They are my <relation>": the tie from me to them (from them to me when reversed, or when the words name the other
    // end: "my mentee"), in its one stored form.
    const directed = TIE_KINDS[kind].directed && (t.reversed === true) !== (read?.reversed === true);
    const c = canonicalTie({ from: directed ? t.with : me, to: directed ? me : t.with, kind });
    candidates.push({ ...c, story: words.story, since: words.since, label: what });
  }
  for (const t of (input.ties ?? []).slice(CIRCLE_LIMITS.ties)) refused.push({ item: "tie", what: clean(t.with), reason: `more than ${CIRCLE_LIMITS.ties} in one write` });
  const history = await pairHistory(db, candidates.map((c) => [c.from, c.to] as [string, string]));
  const ties: PlannedTie[] = [];
  for (const c of candidates) {
    const pair = c.from < c.to ? `${c.from}|${c.to}` : `${c.to}|${c.from}`;
    const clash = pairClash(c.kind, pair, history);
    if (clash) refused.push({ item: "tie", what: c.label, reason: clash });
    else ties.push(c);
  }
  return { people, places, ties, refused };
}

/* --------------------------------------------------- the write --------------------------------------------------- */

const none = (id: string, status: CircleResult["status"], reason?: string, refused: CircleRefusal[] = []): CircleResult => ({
  character_id: id,
  status,
  ...(reason ? { reason } : {}),
  people: 0,
  places: 0,
  ties: 0,
  refused,
});

/**
 * Writes one show character's circle (or, `dryRun`, checks it): its people (and the tie to each), its places, and its
 * ties to other show characters. Skipped when the show has written its circle already, unless `replace`, which first
 * removes the show's earlier people (their ties go with them) and places for it; what an owner or agent declared is
 * never touched. Refused whole for a character that isn't the show's own. Idempotent: the same circle twice writes
 * nothing new (a person is matched by name, a place by its key, a tie by its pair and kind).
 */
export async function writeCircle(db: Db, input: CircleIn, o: CircleOptions, ctx: { show?: ReadonlyMap<string, ShowKind> } = {}): Promise<CircleResult> {
  const env = o.env ?? process.env;
  const me = input.character_id;
  if (!socialTiesOn(env)) return none(me, "refused", "off");
  const ids = [me, ...(input.ties ?? []).map((t) => t.with).filter(Boolean)];
  const show = ctx.show ?? (await showCharacterIds(db, ids));
  if (!show.has(me)) return none(me, "refused", "not one of the show's own characters");
  if (!o.replace && (await hasCircle(db, me))) return none(me, "skipped", "has the show's circle already");
  await ensureWorld(db, env);
  const plan = await planCircle(db, input, o, show);
  const existing = await peopleOf(db, me);
  const showWritten = (p: { source: string }) => p.source === "house" || p.source === "admin";
  // The show's own earlier people, by name: the same name again is the same person (an owner's are never touched).
  const had = new Map(o.replace ? [] : existing.filter(showWritten).map((p) => [p.name.toLowerCase(), p]));
  const room = PEOPLE_CAP - existing.filter((p) => !o.replace || !showWritten(p)).length;
  if (o.dryRun) {
    const fits = Math.max(0, Math.min(plan.people.length, room + plan.people.filter((p) => had.has(p.name.toLowerCase())).length));
    for (const p of plan.people.slice(fits)) plan.refused.push({ item: "person", what: p.name, reason: "cap" });
    return { character_id: me, status: "checked", people: fits, places: plan.places.length, ties: plan.ties.length, refused: plan.refused };
  }

  const provenance = { origin_model: o.origin_model, prompt_version: o.prompt_version };
  const actor = o.actor ?? "system";
  if (o.replace) {
    await db.query(`delete from social_people where holder_id = $1 and source in ('house', 'admin')`, [me]);
    await db.query(`delete from social_place_members where character_id = $1 and source in ('house', 'admin') and role = any($2::text[])`, [me, ["lives", "works", "regular", "studied"]]);
  }
  const out: CircleResult = { character_id: me, status: "written", people: 0, places: 0, ties: 0, refused: plan.refused };
  for (const p of plan.people) {
    const same = had.get(p.name.toLowerCase());
    const w = same
      ? await updatePerson(db, same.id, { pronouns: p.pronouns, note: p.note, deceased: p.deceased, ...provenance }, env)
      : await addPerson(db, { holderId: me, name: p.name, pronouns: p.pronouns, note: p.note, deceased: p.deceased, visibility: "public", source: o.source, ...provenance }, env);
    if (!w.ok) {
      out.refused.push({ item: "person", what: p.name, reason: w.reason });
      continue;
    }
    const tie = await upsertTie(
      db,
      { from: me, toPerson: w.person.id, kind: p.kind, source: o.source, visibility: "public", story: p.story, since_text: p.since, ...provenance, actor },
      env,
    );
    if (!tie.ok) {
      out.refused.push({ item: "person", what: p.name, reason: tie.reason });
      if (!same) await db.query(`delete from social_people where id = $1`, [w.person.id]);
      continue;
    }
    out.people++;
  }
  for (const p of plan.places) {
    if (p.make) {
      await ensurePlace(db, { key: p.make.key, kind: p.make.kind, name: p.make.name, parentKey: p.make.parentKey, description: p.make.description, source: o.source, origin_model: o.origin_model });
    }
    const m = await setMembership(
      db,
      { placeId: p.placeId, characterId: me, role: p.role, source: o.source, visibility: "public", ...(p.since ? { since_text: p.since } : {}), origin_model: o.origin_model },
      env,
    );
    if (m) out.places++;
  }
  for (const t of plan.ties) {
    const w = await upsertTie(db, { from: t.from, to: t.to, kind: t.kind, source: o.source, status: "active", visibility: "public", story: t.story, since_text: t.since, ...provenance, actor }, env);
    if (w.ok) out.ties++;
    else out.refused.push({ item: "tie", what: t.label, reason: w.reason });
  }
  return out;
}

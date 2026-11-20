/**
 * The shared world's places and who belongs to them (docs/PRDs/social-network.md section 5.4). A place is one row with a
 * normalised key (`venue:dive_bar`, `house:kitchen`, `hometown:leeds`); a character belongs to it by role (lives, works,
 * regular, studied, from, visited), one row a role. Who shares a place ("regulars at the dive bar", "both from Leeds")
 * is worked out when read (lib/social/read.ts), never stored as pairs, so a place with ten thousand regulars is ten
 * thousand rows and not fifty million.
 *
 * The world itself (the house, the venues, the city and its neighbourhoods) is seeded by lib/social/world.ts.
 */
import { createHash } from "node:crypto";
import type { Db } from "../db";
import { socialTiesOn } from "./switch";
import type { MembershipInput, PlaceInput, PlaceKind, PlaceMembership, PlaceRole, SocialPlace, Source, Visibility } from "./types";

type Env = Record<string, string | undefined>;

export const PLACE_NAME_MAX = 60;
export const PLACE_DESCRIPTION_MAX = 200;
export const MEMBER_SINCE_MAX = 40;
/** Aired visits to a venue that make a character one of its regulars. */
export const REGULAR_AFTER_VISITS = 3;

/* ------------------------------------------------------ keys ------------------------------------------------------ */

/** A key's slug: accents folded, lower case, apostrophes dropped, anything else between words a dash; at most 48. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= 48) return slug;
  const cut = slug.slice(0, 48);
  return (cut.lastIndexOf("-") > 24 ? cut.slice(0, cut.lastIndexOf("-")) : cut).replace(/-+$/g, "");
}

/** A place's id: a hash of its key, so a seeded place has the same id in every database. */
export const placeIdOf = (key: string): string => `pl_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;

export const venueKey = (venueId: string): string => `venue:${venueId}`;
export const houseKey = (room: string): string => `house:${room}`;

/**
 * A hometown's key and name from what a character's sheet says (extras.hometown, free text). The first place named is
 * the one: "Lagos, then Atlanta" is Lagos, "Leeds (mostly)" is Leeds, "just outside Leeds" is Leeds too, and a leading
 * "the" is dropped from the key ("The Hague" and "the Hague" are one place). Null when nothing usable is left.
 */
export function hometownOf(text: string | null | undefined): { key: string; name: string } | null {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  let first = raw.split(/[,;/(]|\s+then\s+|\s+[–—-]\s+/i)[0].trim();
  first = first.replace(/^(?:just\s+|right\s+)?(?:outside(?:\s+of)?|near|nearby|around|somewhere\s+(?:near|outside(?:\s+of)?|in))\s+/i, "").trim();
  const slug = slugify(first.replace(/^the\s+/i, ""));
  if (!slug) return null;
  return { key: `hometown:${slug}`, name: first.slice(0, PLACE_NAME_MAX) };
}

/* ----------------------------------------------------- places ----------------------------------------------------- */

const PLACE_COLUMNS = `id, key, kind, name, parent_id, venue_id, description, visibility, source, origin_model, created_by, created_at`;

type PlaceRow = Omit<SocialPlace, "created_at" | "kind" | "visibility" | "source"> & { kind: string; visibility: string; source: string; created_at: string | Date };

const placeOf = (r: PlaceRow): SocialPlace => ({
  ...r,
  kind: r.kind as PlaceKind,
  visibility: r.visibility as Visibility,
  source: r.source as Source,
  created_at: new Date(r.created_at).toISOString(),
});

/**
 * Makes sure a place exists, by key, and returns it. A place that's already there is left as it is, unless `refresh`
 * (the seeded world: the code is its source) rewrites its name, kind, parent, venue and description.
 */
export async function ensurePlace(db: Db, input: PlaceInput, o: { refresh?: boolean } = {}): Promise<SocialPlace> {
  const name = input.name.trim().slice(0, PLACE_NAME_MAX);
  const description = input.description?.trim().slice(0, PLACE_DESCRIPTION_MAX) || null;
  const params = [
    placeIdOf(input.key), input.key, input.kind, name, input.parentKey ? placeIdOf(input.parentKey) : null, input.venue_id ?? null, description,
    input.visibility ?? "public", input.source, input.origin_model ?? null, input.created_by ?? null,
  ];
  const conflict = o.refresh
    ? `do update set kind = excluded.kind, name = excluded.name, parent_id = excluded.parent_id, venue_id = excluded.venue_id, description = excluded.description`
    : `do update set key = excluded.key`; // a no-op update, so the existing row comes back
  const { rows } = await db.query<PlaceRow>(
    `insert into social_places (id, key, kind, name, parent_id, venue_id, description, visibility, source, origin_model, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (key) ${conflict}
     returning ${PLACE_COLUMNS}`,
    params,
  );
  return placeOf(rows[0]);
}

/** Seeds many places in one statement (parents may come in the same batch: the foreign key is checked at its end). */
export async function ensurePlaces(db: Db, inputs: readonly PlaceInput[], o: { refresh?: boolean } = {}): Promise<number> {
  if (!inputs.length) return 0;
  const col = <T>(f: (p: PlaceInput) => T) => inputs.map(f);
  const conflict = o.refresh
    ? `do update set kind = excluded.kind, name = excluded.name, parent_id = excluded.parent_id, venue_id = excluded.venue_id, description = excluded.description
         where (social_places.kind, social_places.name, social_places.parent_id, social_places.venue_id, social_places.description)
               is distinct from (excluded.kind, excluded.name, excluded.parent_id, excluded.venue_id, excluded.description)`
    : `do nothing`;
  const { rows } = await db.query(
    `insert into social_places (id, key, kind, name, parent_id, venue_id, description, visibility, source)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
     on conflict (key) ${conflict}
     returning id`,
    [
      col((p) => placeIdOf(p.key)),
      col((p) => p.key),
      col((p) => p.kind),
      col((p) => p.name.trim().slice(0, PLACE_NAME_MAX)),
      col((p) => (p.parentKey ? placeIdOf(p.parentKey) : null)),
      col((p) => p.venue_id ?? null),
      col((p) => p.description?.trim().slice(0, PLACE_DESCRIPTION_MAX) || null),
      col((p) => p.visibility ?? "public"),
      col((p) => p.source),
    ],
  );
  return rows.length;
}

/** One place by id, or null. */
export async function getPlace(db: Db, id: string): Promise<SocialPlace | null> {
  const r = (await db.query<PlaceRow>(`select ${PLACE_COLUMNS} from social_places where id = $1`, [id])).rows[0];
  return r ? placeOf(r) : null;
}

/** One place by key, or null. */
export async function getPlaceByKey(db: Db, key: string): Promise<SocialPlace | null> {
  const r = (await db.query<PlaceRow>(`select ${PLACE_COLUMNS} from social_places where key = $1`, [key])).rows[0];
  return r ? placeOf(r) : null;
}

/** Places by id, in no particular order (for naming the places a page shows). */
export async function placesByIds(db: Db, ids: readonly string[]): Promise<SocialPlace[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<PlaceRow>(`select ${PLACE_COLUMNS} from social_places where id = any($1::text[])`, [[...ids]]);
  return rows.map(placeOf);
}

/** The places inside one (a city's neighbourhoods, a neighbourhood's venues, the house's rooms), by name. */
export async function placesIn(db: Db, parentId: string): Promise<SocialPlace[]> {
  const { rows } = await db.query<PlaceRow>(`select ${PLACE_COLUMNS} from social_places where parent_id = $1 order by name`, [parentId]);
  return rows.map(placeOf);
}

/* --------------------------------------------------- memberships --------------------------------------------------- */

const MEMBER_COLUMNS = `place_id, character_id, role, since_text, started_at, ended_at, source, visibility, detail, origin_model, created_by, created_at, updated_at`;

type MemberRow = Omit<PlaceMembership, "role" | "source" | "visibility" | "started_at" | "ended_at" | "created_at" | "updated_at" | "detail"> & {
  role: string;
  source: string;
  visibility: string;
  detail: unknown;
  started_at: string | Date | null;
  ended_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const isoOrNull = (v: string | Date | null | undefined): string | null => (v === null || v === undefined ? null : new Date(v).toISOString());

const memberOf = (r: MemberRow): PlaceMembership => ({
  ...r,
  role: r.role as PlaceRole,
  source: r.source as Source,
  visibility: r.visibility as Visibility,
  detail: r.detail && typeof r.detail === "object" && !Array.isArray(r.detail) ? (r.detail as Record<string, unknown>) : {},
  started_at: isoOrNull(r.started_at),
  ended_at: isoOrNull(r.ended_at),
  created_at: new Date(r.created_at).toISOString(),
  updated_at: new Date(r.updated_at).toISOString(),
});

/**
 * Puts a character in a place in a role, or updates that membership: given fields are set, the rest kept, `detail`
 * merged key by key. A derived write never rewrites a membership someone declared (the owner said they're a regular)
 * beyond its detail; a declared write on a derived one makes it theirs (its source and created_by). Idempotent; returns
 * the row, or null when the switch is off.
 */
export async function setMembership(db: Db, m: MembershipInput, env: Env = process.env): Promise<PlaceMembership | null> {
  if (!socialTiesOn(env)) return null;
  const sinceText = m.since_text === undefined ? undefined : m.since_text?.trim().slice(0, MEMBER_SINCE_MAX) || null;
  // $12-$16: which fields the write gives; $17: it's derived. `mine` is whether it may set them: not a derived write
  // on a membership someone declared. Nothing changes, nothing is written (and the row is read back below).
  const mine = `not ($17::boolean and m.source <> 'derived')`;
  const { rows } = await db.query<MemberRow>(
    `insert into social_place_members as m (place_id, character_id, role, since_text, started_at, ended_at, source, visibility, detail, origin_model, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     on conflict (place_id, character_id, role) do update set
       detail = m.detail || excluded.detail,
       since_text = case when $12::boolean and ${mine} then excluded.since_text else m.since_text end,
       started_at = case when $13::boolean and ${mine} then excluded.started_at else m.started_at end,
       ended_at = case when $14::boolean and ${mine} then excluded.ended_at else m.ended_at end,
       visibility = case when $15::boolean and ${mine} then excluded.visibility else m.visibility end,
       origin_model = case when $16::boolean and ${mine} then excluded.origin_model else m.origin_model end,
       source = case when m.source = 'derived' and excluded.source <> 'derived' then excluded.source else m.source end,
       created_by = case when m.source = 'derived' and excluded.source <> 'derived' then excluded.created_by else m.created_by end,
       updated_at = now()
     where (m.detail || excluded.detail) is distinct from m.detail
        or (m.source = 'derived' and excluded.source <> 'derived')
        or (${mine} and (($12::boolean and m.since_text is distinct from excluded.since_text)
                      or ($13::boolean and m.started_at is distinct from excluded.started_at)
                      or ($14::boolean and m.ended_at is distinct from excluded.ended_at)
                      or ($15::boolean and m.visibility is distinct from excluded.visibility)
                      or ($16::boolean and m.origin_model is distinct from excluded.origin_model)))
     returning ${MEMBER_COLUMNS}`,
    [
      m.placeId, m.characterId, m.role, sinceText ?? null, isoOrNull(m.started_at), isoOrNull(m.ended_at), m.source, m.visibility ?? "public",
      JSON.stringify(m.detail ?? {}), m.origin_model ?? null, m.created_by ?? null,
      sinceText !== undefined, m.started_at !== undefined, m.ended_at !== undefined, m.visibility !== undefined, m.origin_model !== undefined,
      m.source === "derived",
    ],
  );
  if (rows[0]) return memberOf(rows[0]);
  const same = (
    await db.query<MemberRow>(`select ${MEMBER_COLUMNS} from social_place_members where place_id = $1 and character_id = $2 and role = $3`, [m.placeId, m.characterId, m.role])
  ).rows[0];
  return same ? memberOf(same) : null;
}

/** Ends a membership (they moved out, left the job): it stays, with when. */
export async function endMembership(db: Db, placeId: string, characterId: string, role: PlaceRole, at: string | Date = new Date()): Promise<boolean> {
  const { rows } = await db.query(
    `update social_place_members set ended_at = $4, updated_at = now() where place_id = $1 and character_id = $2 and role = $3 and ended_at is null returning place_id`,
    [placeId, characterId, role, new Date(at).toISOString()],
  );
  return rows.length > 0;
}

/** Removes a membership outright (a derived one whose source was withdrawn). */
export async function removeMembership(db: Db, placeId: string, characterId: string, role: PlaceRole): Promise<boolean> {
  return (await db.query(`delete from social_place_members where place_id = $1 and character_id = $2 and role = $3 returning place_id`, [placeId, characterId, role])).rows.length > 0;
}

/** A character's memberships (current and ended), newest first; `visibility` and `roles` narrow them. */
export async function membershipsOf(
  db: Db,
  characterId: string,
  o: { visibility?: readonly Visibility[]; roles?: readonly PlaceRole[] } = {},
): Promise<PlaceMembership[]> {
  const { rows } = await db.query<MemberRow>(
    `select ${MEMBER_COLUMNS} from social_place_members
      where character_id = $1 and ($2::text[] is null or visibility = any($2)) and ($3::text[] is null or role = any($3))
      order by updated_at desc, place_id, role`,
    [characterId, o.visibility ? [...o.visibility] : null, o.roles ? [...o.roles] : null],
  );
  return rows.map(memberOf);
}

/** A place's members (current only unless `ended`), oldest first; `roles` and `visibility` narrow them. */
export async function membersOf(
  db: Db,
  placeId: string,
  o: { roles?: readonly PlaceRole[]; visibility?: readonly Visibility[]; ended?: boolean; limit?: number } = {},
): Promise<PlaceMembership[]> {
  const { rows } = await db.query<MemberRow>(
    `select ${MEMBER_COLUMNS} from social_place_members
      where place_id = $1 and ($2::text[] is null or role = any($2)) and ($3::text[] is null or visibility = any($3)) and ($4::boolean or ended_at is null)
      order by created_at, character_id, role
      limit $5`,
    [placeId, o.roles ? [...o.roles] : null, o.visibility ? [...o.visibility] : null, o.ended ?? false, o.limit ?? 10_000],
  );
  return rows.map(memberOf);
}

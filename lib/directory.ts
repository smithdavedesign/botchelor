/**
 * The /characters hub (David, 2026-10-21: one Characters page, split three ways): the show's cast (house characters),
 * people's characters and agent-made ones, each a tab (lib/origin.ts says who made what). A private character
 * (characters.visibility; David, #309/#509) is listed in its tab and counted, by name only: no link, no portrait, no
 * traits or reviews. Its page shows only its name to anyone but its owner.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { originSql, type Origin } from "./origin";
import { DELETED_OWNER } from "./rules";
import { notPersonaSql } from "./step-in-shared";
import { statusSql } from "./character-tags";
import type { Status, TagId } from "./tags";

export type DirectoryEntry = {
  id: string;
  name: string;
  traits: string[];
  hue: number | null;
  house: boolean;
  agent: boolean;
  origin: Origin;
  portrait: string | null;
  private: boolean;
  reviews: number;
  stars: number | null;
  /** The basics on the card (David, 2026-10-25): age, pronouns, and what they do and where they're from (extras). */
  age: number | null;
  pronouns: string | null;
  occupation: string | null;
  hometown: string | null;
  /** Anyone may talk with them (lib/companion.ts companionEligible): the house cast (not premium) or companion_open. */
  companion: boolean;
  /** What kind of person they are (lib/character-tags.ts), in vocabulary order; none for a private one. */
  tags: TagId[];
};

/** Cards per page on a long tab. */
export const DIRECTORY_PAGE = 24;

const SELECT = `select c.id, c.name, c.traits, c.avatar_hue as hue, c.is_house as house, c.created_via = 'mcp' as agent,
                      ${originSql("c")} as origin,
                      ${portraitPathSql("c")} as portrait, c.visibility = 'private' as private,
                      (select count(*) from character_reviews r where r.character_id = c.id)::int as reviews,
                      (select round(avg(stars)::numeric, 1)::float from character_reviews r where r.character_id = c.id) as stars,
                      c.age, c.pronouns, nullif(c.extras->>'occupation', '') as occupation, nullif(c.extras->>'hometown', '') as hometown,
                      ((c.is_house and c.premium_sku is null) or c.companion_open) and c.visibility <> 'private' as companion,
                      coalesce((select array_agg(t.tag order by t.tag) from character_tags t where t.character_id = c.id), '{}') as tags
                 from characters c`;

/** A private character keeps only its name (and its id, for a stable avatar tile). */
const shown = (e: DirectoryEntry): DirectoryEntry => (e.private ? { ...e, traits: [], portrait: null, reviews: 0, stars: null, age: null, pronouns: null, occupation: null, hometown: null, companion: false, tags: [] } : e);

/** The most a Yours tab lists (and the Constellation's "Yours" filter counts). */
export const OWN_CHARACTERS_MAX = 50;

/** Someone's own characters (never the house's), newest first: the Yours tab's, and the Constellation's "Yours". */
export async function ownCharacterIds(db: Db, ownerId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select c.id from characters c where c.owner_id = $1 and not c.is_house order by c.created_at desc, c.id limit $2`,
    [ownerId, OWN_CHARACTERS_MAX],
  );
  return rows.map((r) => r.id);
}

/** These characters, in this order (a season's cast, its candidates); a private one by name only. */
export async function directoryEntries(db: Db, ids: string[], opts: { /** The viewer's own characters (the Yours tab): a private one in full. Only ever with ids the caller has checked are theirs. */ own?: boolean } = {}): Promise<DirectoryEntry[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<DirectoryEntry>(`${SELECT} where c.id = any($1)`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, opts.own ? r : shown(r)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** Who's on a made-by tab: people's characters, or agents' (house-run bots included, labelled, after the real agents). */
const TAB_WHERE = {
  people: `not c.is_house and c.created_via <> 'mcp'`,
  agents: `not c.is_house and c.created_via = 'mcp'`,
} as const;
/**
 * Listed at all: not a deleted account's ($1), and not someone's "you" from a step-in date (lib/step-in.ts: a seat at
 * the table, not a character). A private one is listed too, by name only (shown).
 */
const LISTED = `c.owner_id is distinct from $1 and ${notPersonaSql("c")}`;

/** A made-by tab, a page at a time, newest first. */
export async function listTab(
  db: Db,
  tab: "people" | "agents",
  page = 1,
): Promise<{ entries: DirectoryEntry[]; total: number; pages: number; page: number }> {
  const total = (await tabCounts(db))[tab];
  const pages = Math.max(1, Math.ceil(total / DIRECTORY_PAGE));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const order = tab === "agents" ? `${originSql("c")} = 'house_bot', c.created_at desc, c.id` : `c.created_at desc, c.id`;
  const { rows } = await db.query<DirectoryEntry>(`${SELECT} where ${LISTED} and ${TAB_WHERE[tab]} order by ${order} limit $2 offset $3`, [
    DELETED_OWNER,
    DIRECTORY_PAGE,
    (p - 1) * DIRECTORY_PAGE,
  ]);
  return { entries: rows.map(shown), total, pages, page: p };
}

/** House characters that aren't on this season's cast or next season's candidates: earlier seasons, the premium ones. */
export async function offSeasonHouse(db: Db, exclude: string[]): Promise<DirectoryEntry[]> {
  const { rows } = await db.query<DirectoryEntry>(`${SELECT} where c.is_house and not (c.id = any($1)) order by c.name, c.id`, [exclude]);
  return rows.map(shown);
}

/** Which of these characters are private. */
export async function privateAmong(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await db.query<{ id: string }>(`select id from characters where id = any($1) and visibility = 'private'`, [ids]);
  return new Set(rows.map((r) => r.id));
}

/** How many characters each made-by tab lists (private ones included: they're listed by name), and how many of them are private. */
export async function tabCounts(db: Db): Promise<{ people: number; agents: number; private: number }> {
  const { rows } = await db.query<{ people: number; agents: number; private: number }>(
    `select count(*) filter (where ${TAB_WHERE.people})::int as people,
            count(*) filter (where ${TAB_WHERE.agents})::int as agents,
            count(*) filter (where c.visibility = 'private' and not c.is_house)::int as private
       from characters c where ${LISTED}`,
    [DELETED_OWNER],
  );
  return rows[0] ?? { people: 0, agents: 0, private: 0 };
}

/** The most one search on /characters shows; a word more narrows it. */
export const DIRECTORY_SEARCH_LIMIT = 48;
/** The longest search /characters reads (anything past it is cut). */
export const DIRECTORY_QUERY_MAX = 60;
/** The most words a search matches on: each one must be in the character somewhere. */
const SEARCH_WORDS_MAX = 6;

/** ?q= as /characters reads it: one value, spaces squashed, trimmed, at most DIRECTORY_QUERY_MAX characters. */
export function parseDirectoryQuery(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, DIRECTORY_QUERY_MAX);
}

/** A LIKE pattern that finds `word` anywhere, literally: its %, _ and \ are escaped (\ is Postgres' default escape). */
export function likeWord(word: string): string {
  return `%${word.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** What a search on /characters looks in: the name, the bio, the traits, what they do and where they're from. Needs `c`. */
const SEARCHABLE = `lower(concat_ws(' ', c.name, c.bio, c.traits::text, c.extras->>'occupation', c.extras->>'hometown'))`;

/**
 * Find a character on /characters (design audit 2026-11-14: "294 characters and no way to find one"): every word must
 * be in its name, bio, traits, job or hometown. The directory's own rules, stricter where a search could leak: never a
 * deleted account's character (LISTED), and never a private one, not even by name (its bio and traits would answer the
 * search). House characters of every season are in, as the cast tab lists them. Whole-name matches first, then the
 * cast, then by name. At most `limit`; `more` says there were others.
 *
 * Two filters narrow it, with or without words (docs/tags.md): a type tag (lib/character-tags.ts) and a love life,
 * read from the relationship graph's public columns only (statusSql), so a private date never shows who's seeing whom.
 */
export async function searchDirectory(
  db: Db,
  query: string,
  limit = DIRECTORY_SEARCH_LIMIT,
  filters: { type?: TagId | null; status?: Status | null } = {},
): Promise<{ entries: DirectoryEntry[]; more: boolean }> {
  const q = parseDirectoryQuery(query).toLowerCase();
  const words = [...new Set(q.split(" ").filter(Boolean))].slice(0, SEARCH_WORDS_MAX);
  const type = filters.type ?? null;
  const status = filters.status ?? null;
  if (!words.length && !type && !status) return { entries: [], more: false };
  const { rows } = await db.query<DirectoryEntry>(
    `${SELECT}
      where ${LISTED} and c.visibility <> 'private' and ${SEARCHABLE} like all($2::text[])
        and ($5::text is null or exists (select 1 from character_tags t where t.character_id = c.id and t.tag = $5))
        and ($6::text is null or ${statusSql("c.id")} = $6)
      order by lower(c.name) like $3 desc, c.is_house desc, lower(c.name), c.id
      limit $4`,
    [DELETED_OWNER, words.map(likeWord), q ? likeWord(q) : "", limit + 1, type, status],
  );
  return { entries: rows.slice(0, limit).map(shown), more: rows.length > limit };
}

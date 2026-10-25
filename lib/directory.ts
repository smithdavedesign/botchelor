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
};

/** Cards per page on a long tab. */
export const DIRECTORY_PAGE = 24;

const SELECT = `select c.id, c.name, c.traits, c.avatar_hue as hue, c.is_house as house, c.created_via = 'mcp' as agent,
                      ${originSql("c")} as origin,
                      ${portraitPathSql("c")} as portrait, c.visibility = 'private' as private,
                      (select count(*) from character_reviews r where r.character_id = c.id)::int as reviews,
                      (select round(avg(stars)::numeric, 1)::float from character_reviews r where r.character_id = c.id) as stars,
                      c.age, c.pronouns, nullif(c.extras->>'occupation', '') as occupation, nullif(c.extras->>'hometown', '') as hometown
                 from characters c`;

/** A private character keeps only its name (and its id, for a stable avatar tile). */
const shown = (e: DirectoryEntry): DirectoryEntry => (e.private ? { ...e, traits: [], portrait: null, reviews: 0, stars: null, age: null, pronouns: null, occupation: null, hometown: null } : e);

/** These characters, in this order (a season's cast, its candidates); a private one by name only. */
export async function directoryEntries(db: Db, ids: string[]): Promise<DirectoryEntry[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<DirectoryEntry>(`${SELECT} where c.id = any($1)`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, shown(r)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** Who's on a made-by tab: people's characters, or agents' (house-run bots included, labelled, after the real agents). */
const TAB_WHERE = {
  people: `not c.is_house and c.created_via <> 'mcp'`,
  agents: `not c.is_house and c.created_via = 'mcp'`,
} as const;
/** Listed at all: not a deleted account's ($1). A private one is listed too, by name only (shown). */
const LISTED = `c.owner_id is distinct from $1`;

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
       from characters c where c.owner_id is distinct from $1`,
    [DELETED_OWNER],
  );
  return rows[0] ?? { people: 0, agents: 0, private: 0 };
}

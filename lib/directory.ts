/**
 * The /characters directory (David, 2026-10-19: "a characters page that has every character public and private;
 * private not clickable; a section for current season and future season candidates"). Every character on the show,
 * house and made by people or agents. A private one (characters.visibility) is listed by name only: no traits, no
 * portrait, no link.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { DELETED_OWNER } from "./rules";

export type DirectoryEntry = {
  id: string;
  name: string;
  traits: string[];
  hue: number | null;
  house: boolean;
  agent: boolean;
  portrait: string | null;
  private: boolean;
  reviews: number;
  stars: number | null;
};

export const DIRECTORY_PAGE = 60;

const SELECT = `select c.id, c.name, c.traits, c.avatar_hue as hue, c.is_house as house, c.created_via = 'mcp' as agent,
                      ${portraitPathSql("c")} as portrait, c.visibility = 'private' as private,
                      (select count(*) from character_reviews r where r.character_id = c.id)::int as reviews,
                      (select round(avg(stars)::numeric, 1)::float from character_reviews r where r.character_id = c.id) as stars
                 from characters c`;

/** A private character keeps only its name (and its id, for a stable avatar tile). */
const shown = (e: DirectoryEntry): DirectoryEntry => (e.private ? { ...e, traits: [], portrait: null, reviews: 0, stars: null } : e);

/** These characters, in this order (a season's cast, its candidates). */
export async function directoryEntries(db: Db, ids: string[]): Promise<DirectoryEntry[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<DirectoryEntry>(`${SELECT} where c.id = any($1)`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, shown(r)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** Everyone, a page at a time: the house first, then the newest. A deleted account's characters are gone. */
export async function listDirectory(db: Db, page = 1): Promise<{ entries: DirectoryEntry[]; total: number; pages: number }> {
  const p = Math.max(1, Math.floor(page) || 1);
  const [{ rows }, count] = await Promise.all([
    db.query<DirectoryEntry>(`${SELECT} where c.owner_id is distinct from $1 order by c.is_house desc, c.created_at desc, c.id limit $2 offset $3`, [
      DELETED_OWNER,
      DIRECTORY_PAGE,
      (p - 1) * DIRECTORY_PAGE,
    ]),
    db.query<{ n: number }>(`select count(*)::int as n from characters where owner_id is distinct from $1`, [DELETED_OWNER]),
  ]);
  const total = count.rows[0].n;
  return { entries: rows.map(shown), total, pages: Math.max(1, Math.ceil(total / DIRECTORY_PAGE)) };
}

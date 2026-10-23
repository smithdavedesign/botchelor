import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import type { CharacterRef } from "./game";

/**
 * The characters a notification is about, read from its link: a couple or a thread (/couples/a/b, /messages/a/b, an
 * After Dark pair), a character (/characters/id), or a date (/episodes/id, its two). Notifications store only text and
 * a link, so their faces come from here, at read time. Someone else's private character stays faceless (its page shows
 * only its name).
 */
export function idsFromLink(link: string | null): { characters: string[]; episode: string | null } {
  const path = (link ?? "").split(/[?#]/)[0];
  const parts = path.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  if ((parts[0] === "couples" || parts[0] === "messages" || parts[0] === "after-dark") && parts.length >= 3) return { characters: [parts[1], parts[2]], episode: null };
  if (parts[0] === "characters" && parts[1]) return { characters: [parts[1]], episode: null };
  if (parts[0] === "episodes" && parts[1]) return { characters: [], episode: parts[1] };
  return { characters: [], episode: null };
}

/** Each notification's faces (at most two), by its id. */
export async function notificationFaces(db: Db, viewerId: string, items: { id: string; link: string | null }[]): Promise<Map<string, CharacterRef[]>> {
  const parsed = items.map((n) => ({ id: n.id, ...idsFromLink(n.link) }));
  const episodeIds = [...new Set(parsed.map((p) => p.episode).filter((e): e is string => Boolean(e)))];
  const pairs = new Map<string, string[]>();
  if (episodeIds.length) {
    const { rows } = await db.query<{ id: string; character_a: string; character_b: string }>(`select id, character_a, character_b from episodes where id = any($1)`, [episodeIds]);
    for (const r of rows) pairs.set(r.id, [r.character_a, r.character_b]);
  }
  const wanted = parsed.map((p) => ({ id: p.id, ids: p.episode ? (pairs.get(p.episode) ?? []) : p.characters }));
  const all = [...new Set(wanted.flatMap((w) => w.ids))];
  const out = new Map<string, CharacterRef[]>();
  if (!all.length) return out;
  const { rows } = await db.query<CharacterRef & { hidden: boolean }>(
    `select c.id, c.name, c.is_house as house, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait,
            (c.visibility = 'private' and c.owner_id is distinct from $2::text) as hidden
       from characters c where c.id = any($1)`,
    [all, viewerId],
  );
  const byId = new Map(rows.filter((r) => !r.hidden).map(({ hidden: _hidden, ...r }) => [r.id, r]));
  for (const w of wanted) {
    const faces = w.ids.map((id) => byId.get(id)).filter((c): c is CharacterRef => Boolean(c)).slice(0, 2);
    if (faces.length) out.set(w.id, faces);
  }
  return out;
}

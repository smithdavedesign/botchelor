/**
 * Who can be in a person's after-dark scenes (David, 2026-10-18): this season's house cast always, plus the characters
 * that person has switched on. Each person switches only their own characters and the house characters they bring
 * along; never another person's character, which would put it in explicit scenes without its owner. One person's
 * switches never change anyone else's after dark.
 */
import type { Db } from "../db";
import { lastSeasonOn, seasonCastIds, seasonMonth } from "../season-cast";

export type Switchable = { id: string; name: string; house: boolean; on: boolean; season: boolean };

/** Everyone who can be in this person's scenes: the season's cast and the characters they've switched on. */
export async function eligibleIds(db: Db, ownerId: string): Promise<Set<string>> {
  const on = (await db.query<{ character_id: string }>(`select character_id from adult_switches where owner_id = $1`, [ownerId])).rows.map((r) => r.character_id);
  return new Set([...seasonCastIds(), ...on]);
}

/**
 * A pair this person keeps from an earlier cast (#1132; David, 2026-11-01: "keep them playable"): they already have
 * nights of it (a scene with lines or a chapter filed, or a saved night), and one or both of the two are house
 * characters who have since left the season's cast. It stays in their list, marked with the month the cast was, and
 * plays as before. Only that pair: a new pair with someone who left is never offered, and nobody without nights of the
 * pair gets it. A character of their own they switched out isn't kept by this (switching them back in is theirs to do).
 */
export type KeptPair = {
  /** Lower id first, as adult_scenes keeps it. */
  pair: [string, string];
  /** The one(s) of the two no longer in this person's After Dark. */
  gone: string[];
  /** The last season they were on the cast (lib/season-cast.ts lastSeasonOn), when it's known. */
  season: string | null;
  /** "From October's cast". */
  label: string;
};

/** "From October's cast", or, when the month isn't stored, "From a past season's cast". */
export const fromCastLabel = (season: string | null): string => (season ? `From ${seasonMonth(season)}'s cast` : "From a past season's cast");

/** The pairs this person keeps from an earlier cast (KeptPair), or only `pair` (lower id first) when it's given. */
export async function keptPairs(db: Db, ownerId: string, opts: { eligible?: Set<string>; pair?: [string, string] } = {}): Promise<KeptPair[]> {
  const eligible = opts.eligible ?? (await eligibleIds(db, ownerId));
  const [x, y] = opts.pair ?? [null, null];
  const { rows } = await db.query<{ a: string; b: string; a_house: boolean; b_house: boolean }>(
    `with had as (
       select character_a, character_b from adult_scenes
        where owner_id = $1 and (jsonb_array_length(lines) > 0 or chapter > 1) and ($2::text is null or (character_a = $2 and character_b = $3))
       union
       select character_a, character_b from adult_nights where owner_id = $1 and ($2::text is null or (character_a = $2 and character_b = $3))
     )
     select h.character_a as a, h.character_b as b, ca.is_house as a_house, cb.is_house as b_house
       from had h join characters ca on ca.id = h.character_a join characters cb on cb.id = h.character_b`,
    [ownerId, x, y],
  );
  const kept = rows.flatMap((r) => {
    const gone = [r.a, r.b].filter((id) => !eligible.has(id));
    // Both still in: an ordinary pair. Anyone out who isn't a house character: not kept.
    if (!gone.length || (!eligible.has(r.a) && !r.a_house) || (!eligible.has(r.b) && !r.b_house)) return [];
    return [{ pair: [r.a, r.b] as [string, string], gone }];
  });
  if (!kept.length) return [];
  const seasons = await lastSeasonOn(db, [...new Set(kept.flatMap((k) => k.gone))]);
  return kept.map((k) => {
    // Two who left in different months: the night is from the cast the first of them left with.
    const season = k.gone.map((id) => seasons.get(id)).filter((s): s is string => Boolean(s)).sort()[0] ?? null;
    return { ...k, season, label: fromCastLabel(season) };
  });
}

/**
 * Everyone this person may use After Dark's per-character tools on (a face, the baselines, the presence, the steer):
 * eligibleIds, and the ones who left the cast that they keep a pair with (keptPairs). Never for picking a new pair.
 */
export async function playableIds(db: Db, ownerId: string): Promise<Set<string>> {
  const eligible = await eligibleIds(db, ownerId);
  const kept = await keptPairs(db, ownerId, { eligible });
  return new Set([...eligible, ...kept.flatMap((k) => k.gone)]);
}

/**
 * Why a pair isn't in this person's After Dark, for the scene page to say instead of a bare 404 (#1132): who of the two
 * left the cast (and the season they were last on it), and who of their own is switched out. Null when there's nothing
 * to say: a character that doesn't exist, the same one twice, or another person's character (never named here).
 */
export type PairAbsence = { left: { id: string; name: string; season: string | null }[]; off: { id: string; name: string }[] };

export async function pairAbsence(db: Db, ownerId: string, x: string, y: string): Promise<PairAbsence | null> {
  if (!x || !y || x === y) return null;
  const { rows } = await db.query<{ id: string; name: string; is_house: boolean; owner_id: string | null }>(
    `select id, name, is_house, owner_id from characters where id = any($1)`,
    [[x, y]],
  );
  const both = [rows.find((r) => r.id === x), rows.find((r) => r.id === y)];
  if (!both[0] || !both[1]) return null;
  const eligible = await eligibleIds(db, ownerId);
  const out = both.filter((c): c is NonNullable<typeof c> => Boolean(c) && !eligible.has(c!.id));
  if (!out.length || out.some((c) => !c.is_house && c.owner_id !== ownerId)) return null;
  const seasons = await lastSeasonOn(db, out.filter((c) => c.is_house).map((c) => c.id));
  return {
    left: out.filter((c) => c.is_house).map((c) => ({ id: c.id, name: c.name, season: seasons.get(c.id) ?? null })),
    off: out.filter((c) => !c.is_house).map((c) => ({ id: c.id, name: c.name })),
  };
}

/** Whether this person may flip this character's switch: their own, or a house character. */
async function mayFlip(db: Db, ownerId: string, characterId: string): Promise<boolean> {
  const c = (await db.query<{ owner_id: string | null; is_house: boolean }>(`select owner_id, is_house from characters where id = $1`, [characterId])).rows[0];
  return Boolean(c && (c.is_house || c.owner_id === ownerId));
}

export async function setAdultSwitch(db: Db, ownerId: string, characterId: string, on: boolean): Promise<boolean> {
  if (!(await mayFlip(db, ownerId, characterId))) return false;
  if (on) await db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2) on conflict do nothing`, [ownerId, characterId]);
  else await db.query(`delete from adult_switches where owner_id = $1 and character_id = $2`, [ownerId, characterId]);
  return true;
}

/** The person's own characters and the house characters they've dated, with each switch. */
export async function listSwitchable(db: Db, ownerId: string): Promise<Switchable[]> {
  const season = new Set(seasonCastIds());
  const { rows } = await db.query<{ id: string; name: string; is_house: boolean; on: boolean }>(
    `with mine as (select id from characters where owner_id = $1),
          dated as (
            select case when e.character_a in (select id from mine) then e.character_b else e.character_a end as id
              from episodes e
             where e.status = 'ready' and (e.character_a in (select id from mine) or e.character_b in (select id from mine))
          )
     select c.id, c.name, c.is_house, exists (select 1 from adult_switches a where a.owner_id = $1 and a.character_id = c.id) as on
       from characters c
      where c.id in (select id from mine) or (c.is_house and c.id in (select id from dated))
      order by c.is_house, c.name`,
    [ownerId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, house: r.is_house, on: r.on || season.has(r.id), season: season.has(r.id) }));
}

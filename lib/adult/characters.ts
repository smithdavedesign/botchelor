/**
 * Who can be in a person's after-dark scenes (David, 2026-10-18): this season's house cast always, plus the characters
 * that person has switched on. Each person switches only their own characters and the house characters they bring
 * along; never another person's character, which would put it in explicit scenes without its owner. One person's
 * switches never change anyone else's after dark.
 */
import type { Db } from "../db";
import { seasonCastIds } from "../season-cast";

export type Switchable = { id: string; name: string; house: boolean; on: boolean; season: boolean };

/** Everyone who can be in this person's scenes: the season's cast and the characters they've switched on. */
export async function eligibleIds(db: Db, ownerId: string): Promise<Set<string>> {
  const on = (await db.query<{ character_id: string }>(`select character_id from adult_switches where owner_id = $1`, [ownerId])).rows.map((r) => r.character_id);
  return new Set([...seasonCastIds(), ...on]);
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

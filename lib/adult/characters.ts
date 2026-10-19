/**
 * Who can be in after dark (David, 2026-10-18): this season's house cast always, plus any character an admin has
 * switched on. An admin may switch on their own characters and the house characters they date; never another
 * person's character, which would put it in explicit scenes without its owner.
 */
import type { Db } from "../db";
import { seasonCastIds } from "../season-cast";

export type Switchable = { id: string; name: string; house: boolean; on: boolean; season: boolean };

/** Everyone who can be in a scene: the season's cast and the switched-on characters. */
export async function eligibleIds(db: Db): Promise<Set<string>> {
  const on = (await db.query<{ character_id: string }>(`select character_id from adult_characters`)).rows.map((r) => r.character_id);
  return new Set([...seasonCastIds(), ...on]);
}

/** Whether this admin may flip this character's switch: their own, or a house character. */
async function mayFlip(db: Db, adminId: string, characterId: string): Promise<boolean> {
  const c = (await db.query<{ owner_id: string | null; is_house: boolean }>(`select owner_id, is_house from characters where id = $1`, [characterId])).rows[0];
  return Boolean(c && (c.is_house || c.owner_id === adminId));
}

export async function setAdultSwitch(db: Db, adminId: string, characterId: string, on: boolean): Promise<boolean> {
  if (!(await mayFlip(db, adminId, characterId))) return false;
  if (on) await db.query(`insert into adult_characters (character_id, owner_id) values ($1, $2) on conflict (character_id) do nothing`, [characterId, adminId]);
  else await db.query(`delete from adult_characters where character_id = $1`, [characterId]);
  return true;
}

/** The admin's own characters and the house characters they've dated, with each switch. */
export async function listSwitchable(db: Db, adminId: string): Promise<Switchable[]> {
  const season = new Set(seasonCastIds());
  const { rows } = await db.query<{ id: string; name: string; is_house: boolean; on: boolean }>(
    `with mine as (select id from characters where owner_id = $1),
          dated as (
            select case when e.character_a in (select id from mine) then e.character_b else e.character_a end as id
              from episodes e
             where e.status = 'ready' and (e.character_a in (select id from mine) or e.character_b in (select id from mine))
          )
     select c.id, c.name, c.is_house, exists (select 1 from adult_characters a where a.character_id = c.id) as on
       from characters c
      where c.id in (select id from mine) or (c.is_house and c.id in (select id from dated))
      order by c.is_house, c.name`,
    [adminId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, house: r.is_house, on: r.on || season.has(r.id), season: season.has(r.id) }));
}

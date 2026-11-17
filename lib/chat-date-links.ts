/**
 * A chat message knows which date it is about (the connected model, stage 5; docs/companions.md "A text knows its
 * date"). Until 2026-11-16 a text a character sent about a date was tied to it only by its tag
 * (`after_date:<episode id>` in companion_messages.action), a column that is also a scene's stage direction, so "the
 * texts about this date" was a string match. Now the row carries the key: companion_messages.episode_id, set when the
 * text is written (lib/companion.ts writeText, from lib/companion-shared.ts tagEpisode). The tag stays: it is the
 * dedupe key.
 *
 * This file is the backfill for rows written before the column, and the two quiet reads of it:
 *  - in a thread, the dates its texts are about that THIS viewer may open (`threadDates`);
 *  - on a date's page, the viewer's own threads that texted them about it (`textsAboutDate`).
 *
 * Privacy: a companion conversation is its person's alone. Both reads are keyed by the viewer's own user id and only
 * ever return rows of that person's own threads; nothing here is read for anyone else, enters a public read, or names
 * what a text said. A text the person deleted (a blank marker, lib/companion-message-delete.ts) is never counted.
 */
import { DATE_TEXT_TAG_SQL } from "./companion-shared";
import { publicDateSql } from "./date-number";
import type { Db } from "./db";

/**
 * The backfill: sets episode_id on texts whose tag names a date that exists and that have none yet. Idempotent, `limit`
 * rows a call; the hourly job calls it until none are left (then it is one cheap select). A tag whose date is gone
 * stays without one (the join finds nothing, so it never takes a place in the batch), and a deleted text's blank marker
 * (`replaced_by` set) is left as it is: only its tag and its time. Returns how many rows it filled.
 */
export async function backfillMessageEpisodes(db: Db, limit = 2000): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `with todo as (
       select m.id, e.id as episode_id
         from companion_messages m
         join episodes e on e.id = substring(m.action from position(':' in m.action) + 1)
        where m.episode_id is null and m.replaced_by is null and m.role = 'character' and m.scene is null
          and m.action ~ ${DATE_TEXT_TAG_SQL}
        order by m.created_at, m.id
        limit $1
     )
     update companion_messages m set episode_id = todo.episode_id from todo where m.id = todo.id returning m.id`,
    [limit],
  );
  return rows.length;
}

/**
 * The dates this thread's texts are about, each with the partner's name, for the thread's own person: only a date they
 * may open. That is the rule the date's page itself applies (lib/game.ts getEpisodeView), narrowed to what a link
 * should offer: they own one of the two, or it aired publicly between two public characters (lib/date-number.ts
 * publicDateSql: ready, public, aired, not hidden by reports, not a replay). The thread's character must be one of the
 * two. One statement, whatever the number of texts.
 */
export async function threadDates(db: Db, o: { threadId: string; characterId: string; viewer: string }): Promise<Map<string, { partner: string }>> {
  const { rows } = await db.query<{ id: string; partner: string }>(
    `select e.id, case when e.character_a = $2 then b.name else a.name end as partner
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id in (select m.episode_id from companion_messages m where m.thread_id = $1 and m.episode_id is not null and m.replaced_by is null)
        and $2 in (e.character_a, e.character_b)
        and (coalesce($3::text in (a.owner_id, b.owner_id), false)
             or (${publicDateSql("e")} and a.visibility = 'public' and b.visibility = 'public'))`,
    [o.threadId, o.characterId, o.viewer],
  );
  return new Map(rows.map((r) => [r.id, { partner: r.partner }]));
}

export type TextedAbout = { thread_id: string; character_id: string; name: string };

/**
 * The viewer's own threads in which the character texted them about this date, oldest text first. Asked only for an
 * owner of one of the date's two characters (the page checks; the join below checks again: the thread is theirs AND
 * they own a side), so nobody else is ever shown a line, and nobody is shown anyone else's thread.
 */
export async function textsAboutDate(db: Db, viewer: string, episodeId: string): Promise<TextedAbout[]> {
  const { rows } = await db.query<TextedAbout>(
    `select t.id as thread_id, c.id as character_id, c.name
       from companion_threads t
       join characters c on c.id = t.character_id
       join lateral (select min(m.created_at) as first_at from companion_messages m
                      where m.thread_id = t.id and m.episode_id = $2 and m.role = 'character' and m.replaced_by is null) said on said.first_at is not null
      where t.user_id = $1
        and exists (select 1 from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b
                     where e.id = $2 and $1 in (a.owner_id, b.owner_id) and t.character_id in (e.character_a, e.character_b))
      order by said.first_at, t.id`,
    [viewer, episodeId],
  );
  return rows;
}

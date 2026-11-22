/**
 * "Up next" at the end of an episode (2026-11-22 audit: an episode ended on its guess results and the footer, and the
 * only ways on were a small "More episodes" link and "Previously on", which goes backwards). What to watch after this
 * date: the same couple's next aired date when there is one, then the newest other aired dates.
 *
 * One statement, and a cheap one: the picks are found on a few small columns (the pair, when it aired, its night) and
 * only the few picked rows are read for their cards, so no date's lines, recap or sheets are read to choose (the
 * episodes table's big columns are most of its weight). The same rules as every public list (lib/game.ts
 * PUBLIC_FEED_WHERE: public, ready, aired, not hidden by reports, nobody the viewer blocked), never a replay, and for
 * the newest dates never one of the viewer's own (their account page lists those, as Watch leaves them out), nor
 * another date of this couple or another table of this mixer night (the page links that night already), and one table
 * per mixer night, so a night's tables don't fill the row. Spoiler-free: a card carries no ending.
 */
import type { Db } from "./db";
import { dateNumberSql } from "./date-number";
import { NOT_THE_VIEWERS, PUBLIC_FEED_WHERE, type EpisodeView } from "./game";
import { portraitPathSql } from "./portrait-sql";
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { sentenceCase } from "./sentence-case";
import type { PlaceId } from "./venues";

/** How many cards: a row of three on a wide screen (app/EpisodeShelf.tsx). */
export const UP_NEXT_LIMIT = 3;

/** What a card needs (app/EpisodeShelf.tsx ShelfEpisode), and whether it's this couple's next date. */
export type UpNextEpisode = Pick<EpisodeView, "id" | "share_path" | "characters" | "revealed" | "setting" | "venue" | "title" | "date_number"> & {
  next_of_couple: boolean;
};

type Row = {
  id: string;
  title: string | null;
  setting: string;
  venue: string | null;
  date_number: number | null;
  next_of_couple: boolean;
  a_id: string;
  a_name: string;
  a_house: boolean;
  a_hue: number | null;
  a_portrait: string | null;
  a_agent: boolean;
  a_private: boolean;
  b_id: string;
  b_name: string;
  b_house: boolean;
  b_hue: number | null;
  b_portrait: string | null;
  b_agent: boolean;
  b_private: boolean;
};

const PAIR = (x: string, y: string) =>
  `((${x}.character_a = ${y}.character_a and ${x}.character_b = ${y}.character_b) or (${x}.character_a = ${y}.character_b and ${x}.character_b = ${y}.character_a))`;

/** The listed dates' tables, with their characters and report count, as PUBLIC_FEED_WHERE needs them. */
const LISTED = `episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
         cross join lateral (select count(*)::int as n from reports r where r.episode_id = e.id) rep`;

/** The cards after episode `episodeId` for `viewerId` (or a signed-out visitor), at most `limit`, best first. */
export async function upNextFor(db: Db, episodeId: string, viewerId: string | null, limit = UP_NEXT_LIMIT): Promise<UpNextEpisode[]> {
  const { rows } = await db.query<Row>(
    `with cur as (select id, character_a, character_b, created_at, group_id from episodes where id = $3),
     -- Their next date: the first of the pair's dates booked after this one (lib/previously-on.ts reads the one before).
     nxt as (
       select e.id
         from cur, ${LISTED}
        where ${PAIR("e", "cur")} and (e.created_at, e.id) > (cur.created_at, cur.id)
          and ${PUBLIC_FEED_WHERE} and e.revealed_at is not null and e.varies_episode_id is null
        order by e.created_at, e.id
        limit 1),
     -- The newest aired dates, a few more than needed, so a mixer night's tables can be cut to one.
     recent as (
       select e.id, e.revealed_at, coalesce(e.group_id, e.id) as night
         from cur, ${LISTED}
        where e.id <> cur.id and not ${PAIR("e", "cur")} and (cur.group_id is null or e.group_id is distinct from cur.group_id)
          and ${PUBLIC_FEED_WHERE} and e.revealed_at is not null and e.varies_episode_id is null and ${NOT_THE_VIEWERS}
        order by e.revealed_at desc, e.id
        limit $4::int * 4),
     others as (
       select id, revealed_at
         from (select id, revealed_at, row_number() over (partition by night order by revealed_at desc, id) as k from recent) r
        where k = 1
        order by revealed_at desc, id
        limit $4::int),
     picks as (
       select id, 0 as slot, null::timestamptz as at from nxt
        union all
       select id, 1 as slot, revealed_at as at from others)
     select e.id, e.title, e.setting, e.setup->>'venue' as venue, ${dateNumberSql("e")} as date_number, p.slot = 0 as next_of_couple,
            a.id as a_id, a.name as a_name, a.is_house as a_house, a.avatar_hue as a_hue, ${portraitPathSql("a")} as a_portrait, a.created_via = 'mcp' as a_agent,
            (a.visibility = 'private' and a.owner_id is distinct from $1::text) as a_private,
            b.id as b_id, b.name as b_name, b.is_house as b_house, b.avatar_hue as b_hue, ${portraitPathSql("b")} as b_portrait, b.created_via = 'mcp' as b_agent,
            (b.visibility = 'private' and b.owner_id is distinct from $1::text) as b_private
       from picks p
       join episodes e on e.id = p.id
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      order by p.slot, p.at desc nulls first, e.id
      limit $4::int`,
    [viewerId, REPORT_HIDE_THRESHOLD, episodeId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    share_path: `/episodes/${r.id}`,
    revealed: true,
    setting: r.setting,
    ...(r.title ? { title: sentenceCase(r.title, [r.a_name, r.b_name], r.setting) } : {}),
    ...(r.venue ? { venue: r.venue as PlaceId } : {}),
    ...(r.date_number && r.date_number > 1 ? { date_number: r.date_number } : {}),
    next_of_couple: r.next_of_couple,
    characters: [
      { id: r.a_id, name: r.a_name, house: r.a_house, hue: r.a_hue, portrait: r.a_portrait, agent: r.a_agent, ...(r.a_private ? { private: true } : {}) },
      { id: r.b_id, name: r.b_name, house: r.b_house, hue: r.b_hue, portrait: r.b_portrait, agent: r.b_agent, ...(r.b_private ? { private: true } : {}) },
    ],
  }));
}

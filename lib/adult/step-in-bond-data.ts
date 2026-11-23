/**
 * The rows behind a Step in relationship level (lib/adult/step-in-bond.ts says what it is and what it is not): what
 * the viewer and a character have done together, read from the scenes' own tables in one statement, and the most the
 * level has ever been, kept in adult_step_in_bonds so that deleting a scene can't lower it.
 *
 * One statement for one pair and the same one for every pair of a viewer's (the Characters page and the shelf show a
 * mark a card, and must never ask once a card). Days are UTC's: nobody's time zone is known here.
 */
import type { Db } from "../db";
import { BOND_WORTH, bondMark, bondPoints, bondView, NO_BOND_SINCE, type BondMark, type BondSince, type StepInBond } from "./step-in-bond";

type Row = {
  character_id: string;
  days: number;
  lines: number;
  lines_counted: number;
  scenes: number;
  scenes_counted: number;
  stories: number;
  stories_counted: number;
  calls: number;
  call_days: number;
  pictures: number;
  picture_days: number;
  facts: number;
  stored: number | null;
  shown: number | null;
};

const of = (cte: string, expr: string) => `coalesce((select ${expr} from ${cte} where ${cte}.character_id = ids.character_id), 0)::int`;

/**
 * Every pair of this viewer's (or the one with `$2`), a row each: the real totals, the totals held to their day's caps
 * (lib/adult/step-in-bond.ts BOND_WORTH), and what's kept for the pair. A scene counts on the day of its first line; a
 * story on the day its last beat played; a spoken reply on a call is kind 'call'; a picture is one kept for a scene.
 */
const BONDS_SQL = `
with sc as (
  select id, character_id, story_done_at from adult_step_in_scenes where owner_id = $1 and ($2::text is null or character_id = $2)
),
vl as (
  select sc.character_id, (m.created_at at time zone 'utc')::date as day, count(*)::int as n
    from adult_step_in_messages m join sc on sc.id = m.scene_id
   where m.role = 'viewer'
   group by 1, 2
),
fs as (
  select character_id, day, count(*)::int as n
    from (
      select sc.character_id, sc.id, min((m.created_at at time zone 'utc')::date) as day
        from adult_step_in_messages m join sc on sc.id = m.scene_id
       where m.role = 'viewer'
       group by 1, 2
    ) first_lines
   group by 1, 2
),
st as (
  select character_id, (story_done_at at time zone 'utc')::date as day, count(*)::int as n from sc where story_done_at is not null group by 1, 2
),
ca as (
  select sc.character_id, (m.created_at at time zone 'utc')::date as day, count(*)::int as n
    from adult_step_in_messages m join sc on sc.id = m.scene_id
   where m.role = 'character' and m.kind = 'call'
   group by 1, 2
),
pi as (
  select sc.character_id, (i.created_at at time zone 'utc')::date as day, count(*)::int as n
    from adult_images i join sc on sc.id = i.step_in_scene
   where i.owner_id = $1 and i.status = 'ready' and i.kind = 'scene'
   group by 1, 2
),
fa as (
  select character_id, count(*)::int as n from adult_step_in_facts where owner_id = $1 and ($2::text is null or character_id = $2) group by 1
),
ids as (
  select character_id from sc
  union select character_id from fa
  union select character_id from adult_step_in_bonds where owner_id = $1 and ($2::text is null or character_id = $2)
)
select ids.character_id,
       ${of("vl", "count(*)")} as days,
       ${of("vl", "sum(n)")} as lines,
       ${of("vl", "sum(least(n, $3::int))")} as lines_counted,
       ${of("fs", "sum(n)")} as scenes,
       ${of("fs", "sum(least(n, $4::int))")} as scenes_counted,
       ${of("st", "sum(n)")} as stories,
       ${of("st", "sum(least(n, $5::int))")} as stories_counted,
       ${of("ca", "sum(n)")} as calls,
       ${of("ca", "count(*)")} as call_days,
       ${of("pi", "sum(n)")} as pictures,
       ${of("pi", "count(*)")} as picture_days,
       ${of("fa", "max(n)")} as facts,
       b.points as stored,
       b.shown_level as shown
  from ids
  left join adult_step_in_bonds b on b.owner_id = $1 and b.character_id = ids.character_id`;

const CAPS = [BOND_WORTH.linesADay, BOND_WORTH.scenesADay, BOND_WORTH.storiesADay];

const sinceOf = (r: Row): BondSince => ({ days: Number(r.days), lines: Number(r.lines), scenes: Number(r.scenes), stories: Number(r.stories), calls: Number(r.calls), pictures: Number(r.pictures), facts: Number(r.facts) });
const derivedOf = (r: Row): number =>
  bondPoints({
    days: Number(r.days),
    lines: Number(r.lines_counted),
    scenes: Number(r.scenes_counted),
    stories: Number(r.stories_counted),
    callDays: Number(r.call_days),
    pictureDays: Number(r.picture_days),
    facts: Number(r.facts),
  });

/** A pair's level, and the level the scene has already said out loud (0: none yet). */
export type BondRead = { bond: StepInBond; shown: number };

/**
 * One pair's level as it stands. `lift` (the default): when what's derived now is more than what's kept, the kept
 * number is raised to it (and never lowered: one statement, `greatest`), so a scene deleted later can't take it back.
 */
export async function bondOf(db: Db, viewer: string, characterId: string, o: { lift?: boolean } = {}): Promise<BondRead> {
  const r = (await db.query<Row>(BONDS_SQL, [viewer, characterId, ...CAPS])).rows[0];
  const derived = r ? derivedOf(r) : 0;
  const stored = Number(r?.stored ?? 0);
  const bond = bondView(derived, stored, r ? sinceOf(r) : NO_BOND_SINCE);
  if (o.lift !== false && derived > stored) {
    await db.query(
      `insert into adult_step_in_bonds (owner_id, character_id, points, level, updated_at) values ($1, $2, $3::int, $4::int, now())
       on conflict (owner_id, character_id) do update
         set points = greatest(adult_step_in_bonds.points, excluded.points), level = greatest(adult_step_in_bonds.level, excluded.level), updated_at = now()`,
      [viewer, characterId, bond.points, bond.level],
    );
  }
  return { bond, shown: Number(r?.shown ?? 0) };
}

/** The scene has said this level out loud: it isn't said again (never lowered either). */
export async function markBondShown(db: Db, viewer: string, characterId: string, level: number, points: number): Promise<void> {
  await db.query(
    `insert into adult_step_in_bonds (owner_id, character_id, points, level, shown_level, updated_at) values ($1, $2, $4::int, $3::int, $3::int, now())
     on conflict (owner_id, character_id) do update set shown_level = greatest(adult_step_in_bonds.shown_level, excluded.shown_level)`,
    [viewer, characterId, level, points],
  );
}

/**
 * Every character this viewer has a level with, as the small mark a list shows: one statement for all of them, nothing
 * written. Strangers have no mark, so a character they've done nothing with isn't in it.
 */
export async function bondMarks(db: Db, viewer: string): Promise<Map<string, BondMark>> {
  const { rows } = await db.query<Row>(BONDS_SQL, [viewer, null, ...CAPS]);
  const marks = new Map<string, BondMark>();
  for (const r of rows) {
    const mark = bondMark(Math.max(derivedOf(r), Number(r.stored ?? 0)));
    if (mark) marks.set(r.character_id, mark);
  }
  return marks;
}

/** For After Dark's download (lib/adult/profile-data.ts): every pair's level as it's shown, and what it's made of. */
export async function exportBonds(db: Db, viewer: string): Promise<{ character_id: string; level: number; name: string; points: number; since: BondSince }[]> {
  const { rows } = await db.query<Row>(BONDS_SQL, [viewer, null, ...CAPS]);
  return rows
    .map((r) => ({ character_id: r.character_id, ...bondView(derivedOf(r), Number(r.stored ?? 0), sinceOf(r)) }))
    .filter((b) => b.points > 0)
    .map(({ character_id, level, name, points, since }) => ({ character_id, level, name, points, since }))
    .sort((x, y) => y.points - x.points || x.character_id.localeCompare(y.character_id));
}

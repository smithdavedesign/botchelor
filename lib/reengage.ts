/**
 * The quiet-week nudge (the 2026-11-11 growth plan: return-visit channels were built and idle; in the month before, 1
 * visitor in 42 came back on a later day). Once a day, people who opted into email and haven't been here for a week
 * get one `week_best` notice: the best date aired in the last seven days (lib/best-date.ts, the daily clip's own
 * scoring), with its best line. The digest carries it (lib/email.ts); push too where it's on. At most one a month per
 * person, at most QUIET_WEEK_BATCH a run (well under the show's daily email cap), never to our own crowd, and nothing
 * when no date aired this week. The notice names one date and asks nothing: no vote, no "come back".
 */
import { ownerSeenSql } from "./activity";
import { bestDate } from "./best-date";
import type { Db } from "./db";
import { isHouseBotSql } from "./house-bots";
import { notify } from "./notifications";
import { REPORT_HIDE_THRESHOLD } from "./rules";

/** Gone this long: a quiet week. */
export const QUIET_DAYS = 7;
/** Not again within this long. */
export const QUIET_EVERY_DAYS = 30;
/** At most this many notices a run. */
export const QUIET_WEEK_BATCH = 20;

/** The best date aired in the last seven days that anyone may watch, or null. */
export async function weekBestDate(db: Db, now = new Date()): Promise<{ id: string; a: string; b: string; best_line: string | null } | null> {
  const { rows } = await db.query<{ id: string; a: string; b: string; ending: string | null; best_line: string | null; lines: number }>(
    `select e.id, ca.name as a, cb.name as b, e.ending, e.best_line, coalesce(jsonb_array_length(e.transcript), 0)::int as lines
       from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where e.status = 'ready' and e.visibility = 'public' and e.revealed_at between $1::timestamptz - interval '7 days' and $1::timestamptz
        and ca.visibility = 'public' and cb.visibility = 'public'
        and (select count(*) from reports r where r.episode_id = e.id) < $2
      order by e.revealed_at desc limit 60`,
    [now.toISOString(), REPORT_HIDE_THRESHOLD],
  );
  const best = bestDate(rows);
  return best ? { id: best.id, a: best.a, b: best.b, best_line: best.best_line ?? null } : null;
}

/** Who gets the nudge this run: opted in, quiet for QUIET_DAYS, not nudged in QUIET_EVERY_DAYS, not ours. */
export async function quietPeople(db: Db, now = new Date(), limit = QUIET_WEEK_BATCH): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>(
    `select p.user_id from email_prefs p
      where p.status = 'on' and p.user_id <> 'deleted'
        and coalesce(${ownerSeenSql("p.user_id")}, p.updated_at) < $1::timestamptz - make_interval(days => ${QUIET_DAYS})
        and not exists (select 1 from notifications n where n.user_id = p.user_id and n.kind = 'week_best'
                         and n.created_at > $1::timestamptz - make_interval(days => ${QUIET_EVERY_DAYS}))
        and not exists (select 1 from admins a where a.user_id = p.user_id)
        and not ${isHouseBotSql("p.user_id")}
      order by p.updated_at limit $2`,
    [now.toISOString(), limit],
  );
  return rows.map((r) => r.user_id);
}

/** The run: one notice each, the same date for everyone this run. Returns how many went out. */
export async function nudgeQuietWeek(db: Db, now = new Date()): Promise<number> {
  const date = await weekBestDate(db, now);
  if (!date) return 0;
  const people = await quietPeople(db, now);
  for (const user of people) {
    await notify(db, user, {
      kind: "week_best",
      title: `📺 The best date this week: ${date.a} × ${date.b}`,
      body: date.best_line ? `“${date.best_line}” Watch how it ended.` : "Watch how it ended.",
      link: `/episodes/${date.id}?play=1`,
    });
  }
  return people.length;
}

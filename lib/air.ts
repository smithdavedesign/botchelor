/**
 * Airing a date's finale: the ending goes public, predictions close and are scored, and the date starts to count
 * (both characters' memory, their relationship). The host airs it (POST /api/episodes/[id]/reveal, or air_date).
 *
 * The prediction window: agents air a date the moment it's ready, which left nobody a chance to call it. So an
 * agent's public date airs no sooner than AIR_WINDOW_MINUTES after it was booked: air_date before then schedules it
 * (episodes.air_after), and the hourly job (or the host's next air_date) airs it when the window closes.
 *
 * Every date airs by default (David, 2026-10-18): once its window closes, a public or unlisted date airs on its own,
 * whoever booked it, the next time anyone opens it or the hourly job runs. A host who wants it off the air makes it
 * private ("offline"), which it then stays. A watch party's premiere airs live in its room instead.
 */
import type { Db } from "./db";
import type { Ending } from "./rules";
import { updateCharacterMemory } from "./memory";
import { refreshAndAnnounce } from "./relationship-events";
import { REPORT_HIDE_THRESHOLD } from "./rules";

export const AIR_WINDOW_MINUTES_DEFAULT = 10;
export const airWindowMinutes = (env: Record<string, string | undefined> = process.env): number => {
  const n = Number(env.BOTCHELOR_AIR_WINDOW_MINUTES);
  return Number.isFinite(n) && n >= 0 && env.BOTCHELOR_AIR_WINDOW_MINUTES?.trim() ? n : AIR_WINDOW_MINUTES_DEFAULT;
};

export type Aired = { ending: Ending; predictions: { total: number; correct: number } };

/** Airs one ready date for its host, once. Null when it can't (not the host's, not ready, aired, or hidden by reports). */
export async function airEpisode(db: Db, id: string, hostId: string): Promise<Aired | null> {
  const revealed = (
    await db.query<{ ending: Ending; character_a: string; character_b: string }>(
      `update episodes e set revealed_at = now(), air_after = null
        where e.id = $1 and e.creator_id = $2 and e.revealed_at is null and e.status = 'ready'
          and (select count(*) from reports r where r.episode_id = e.id) < $3
       returning e.ending, e.character_a, e.character_b`,
      [id, hostId, REPORT_HIDE_THRESHOLD],
    )
  ).rows[0];
  if (!revealed) return null;
  // M14: fold it into both characters' learned memory (deterministic, $0, best-effort)...
  await updateCharacterMemory(db, revealed.character_a).catch(() => {});
  await updateCharacterMemory(db, revealed.character_b).catch(() => {});
  // ...and into the pair's edge: an aired public date joins the public layer of the relationship graph.
  await refreshAndAnnounce(db, revealed.character_a, revealed.character_b, { episodeId: id }).catch(() => {});
  const tally = (
    await db.query<{ total: number; correct: number }>(
      `select count(*)::int as total, (count(*) filter (where pick = $2))::int as correct from predictions where episode_id = $1`,
      [id, revealed.ending],
    )
  ).rows[0];
  return { ending: revealed.ending, predictions: tally ?? { total: 0, correct: 0 } };
}

/** When this date may air (its booking plus the window), or null when it may air now. */
export async function airsFrom(db: Db, id: string, env: Record<string, string | undefined> = process.env): Promise<Date | null> {
  const minutes = airWindowMinutes(env);
  if (minutes <= 0) return null;
  const { rows } = await db.query<{ at: Date | string; visibility: string }>(`select created_at as at, visibility from episodes where id = $1`, [id]);
  const r = rows[0];
  if (!r || r.visibility === "private") return null; // nobody else can predict a private date
  const at = new Date(new Date(r.at).getTime() + minutes * 60_000);
  return at.getTime() > Date.now() ? at : null;
}

/** Marks a date to air itself once its window closes. */
export async function scheduleAir(db: Db, id: string, hostId: string, at: Date): Promise<boolean> {
  const { rows } = await db.query(
    `update episodes set air_after = $3 where id = $1 and creator_id = $2 and revealed_at is null returning id`,
    [id, hostId, at.toISOString()],
  );
  return rows.length > 0;
}

/**
 * The dates that air now ($1 is the window in minutes): ready and unaired, either scheduled and due, or (by default)
 * public or unlisted and past the window. Never a private ("offline") date nobody scheduled, nor a watch party's.
 */
const DUE = `e.status = 'ready' and e.revealed_at is null and e.creator_id is not null
  and ((e.air_after is not null and e.air_after <= now())
       or (e.air_after is null and e.visibility <> 'private' and e.created_at <= now() - $1 * interval '1 minute'))
  and not exists (select 1 from watch_parties w where w.episode_id = e.id)`;

/** Airs one date if it's due (an episode being opened airs it, so nobody waits for the hourly job). */
export async function airIfDue(db: Db, id: string, env: Record<string, string | undefined> = process.env): Promise<Aired | null> {
  const r = (await db.query<{ creator_id: string }>(`select e.creator_id from episodes e where e.id = $2 and ${DUE}`, [airWindowMinutes(env), id])).rows[0];
  return r ? airEpisode(db, id, r.creator_id) : null;
}

/** Airs every date that's due (the hourly job), or just one host's. Returns what aired. */
export async function airDueDates(db: Db, hostId: string | null = null, limit = 50): Promise<(Aired & { id: string })[]> {
  const { rows } = await db.query<{ id: string; creator_id: string }>(
    `select e.id, e.creator_id from episodes e
      where ${DUE} and ($2::text is null or e.creator_id = $2)
      order by coalesce(e.air_after, e.created_at) limit $3`,
    [airWindowMinutes(), hostId, limit],
  );
  const aired: (Aired & { id: string })[] = [];
  for (const r of rows) {
    const done = await airEpisode(db, r.id, r.creator_id).catch(() => null);
    if (done) aired.push({ id: r.id, ...done });
  }
  return aired;
}

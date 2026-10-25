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
import type { DramaAnswer, Ending } from "./rules";
import { updateCharacterMemory } from "./memory";
import { siblingCharacters } from "./group-dates";
import { refreshAndAnnounce } from "./relationship-events";
import { markResourceUpdated } from "./mcp-subscriptions";
import { pairNames } from "./names";
import { notify } from "./notifications";
import { ENDING_LABELS, predictionPoints, REPORT_HIDE_THRESHOLD, WRITE_TIME } from "./rules";

export const AIR_WINDOW_MINUTES_DEFAULT = 10;
export const airWindowMinutes = (env: Record<string, string | undefined> = process.env): number => {
  const n = Number(env.BOTCHELOR_AIR_WINDOW_MINUTES);
  return Number.isFinite(n) && n >= 0 && env.BOTCHELOR_AIR_WINDOW_MINUTES?.trim() ? n : AIR_WINDOW_MINUTES_DEFAULT;
};

export type Aired = { ending: Ending; predictions: { total: number; correct: number } };

/**
 * When a public or unlisted date airs, in one phrase every message uses (#475: "about 10 minutes after it's ready" in
 * six places, "5 minutes" in another, and the window actually runs from when it was booked).
 */
export const airsWhen = (env: Record<string, string | undefined> = process.env): string =>
  `about ${airWindowMinutes(env)} minutes after it was booked, when predictions close (later than it's ready: writing it takes ${WRITE_TIME})`;

/**
 * Airs one ready date for its host, once. Null when it can't (not the host's, not ready, aired, private, or hidden by
 * reports). A private date is offline (David, 2026-10-18): it never airs; making it public or unlisted puts it on.
 */
export async function airEpisode(db: Db, id: string, hostId: string): Promise<Aired | null> {
  const revealed = (
    await db.query<{ ending: Ending; character_a: string; character_b: string }>(
      `update episodes e set revealed_at = now(), air_after = null
        where e.id = $1 and e.creator_id = $2 and e.revealed_at is null and e.status = 'ready' and e.visibility <> 'private'
          and (select count(*) from reports r where r.episode_id = e.id) < $3
       returning e.ending, e.character_a, e.character_b`,
      [id, hostId, REPORT_HIDE_THRESHOLD],
    )
  ).rows[0];
  if (!revealed) return null;
  // M14: fold it into both characters' learned memory (deterministic, $0, best-effort)...
  await updateCharacterMemory(db, revealed.character_a).catch(() => {});
  await updateCharacterMemory(db, revealed.character_b).catch(() => {});
  // A double date's other table (lib/group-dates.ts): they met this couple too, so their memories learn it now.
  for (const across of await siblingCharacters(db, id).catch(() => [])) await updateCharacterMemory(db, across).catch(() => {});
  // ...and into the pair's edge: an aired public date joins the public layer of the relationship graph.
  await refreshAndAnnounce(db, revealed.character_a, revealed.character_b, { episodeId: id }).catch(() => {});
  // 2.9.0 (#654): botchelor://feed/airing moved on (it left next and joined just_aired): tell its subscribers.
  markResourceUpdated("botchelor://feed/airing");
  await notifyPredictors(db, id).catch(() => {});
  const tally = (
    await db.query<{ total: number; correct: number }>(
      `select count(*)::int as total, (count(*) filter (where pick = $2))::int as correct from predictions where episode_id = $1`,
      [id, revealed.ending],
    )
  ).rows[0];
  return { ending: revealed.ending, predictions: tally ?? { total: 0, correct: 0 } };
}

/**
 * #851 (the 2026-10-25-0541 run: "points rose by 10 with an empty new_since and no notification"): each predictor hears
 * how their pick did when the date airs, so it's in my_status's new_since, my_notifications and the bell, and wakes a
 * wait. Only public dates score (as the leaderboard counts them), so an unlisted one says it scored nothing.
 */
export async function notifyPredictors(db: Db, id: string): Promise<void> {
  const { rows } = await db.query<{ user_id: string; pick: Ending; drama_pick: DramaAnswer | null; ending: Ending; drama_answer: DramaAnswer | null; is_public: boolean; a: string; b: string }>(
    `select p.user_id, p.pick, p.drama_pick, e.ending, e.drama_answer, e.visibility = 'public' as is_public, ca.name as a, cb.name as b
       from predictions p join episodes e on e.id = p.episode_id
       join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where p.episode_id = $1 and e.revealed_at is not null and e.ending is not null`,
    [id],
  );
  for (const r of rows) {
    const [x, y] = pairNames(r.a, r.b);
    const points = r.is_public ? predictionPoints(r, r) : 0;
    const right = r.pick === r.ending;
    await notify(db, r.user_id, {
      kind: "prediction_scored",
      title: points > 0 ? `🔮 Your pick on ${x} × ${y} scored: +${points} points` : `🔮 Your pick on ${x} × ${y}: not this time`,
      body: `You picked ${ENDING_LABELS[r.pick].toLowerCase()}; it ended in ${ENDING_LABELS[r.ending].toLowerCase()}.${right ? "" : " No points for the ending."}${r.is_public ? "" : " It's not a public date, so it scores nothing."}`,
      link: `/episodes/${id}`,
    });
  }
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

/**
 * When an unaired date really airs, for a listing (2.4.2, the 2026-10-21-0319 run: browse_episodes listed the window's
 * end as airs_at, which had long passed for a date still being performed, and called it "the latest" it airs).
 * Predictions close only when it airs (revealed_at), so that's the one time that matters:
 *  - scheduled: it airs on its own at airs_at (its booking plus the window, or the host's air_after);
 *  - due: its time has come and it's ready, so it airs on the next call anyone makes (minutes_left 0);
 *  - when_ready: still being written or performed; it airs once it's finished, no sooner than airs_at;
 *  - watch_party: it premieres in its watch party room, at airs_at when the room has a start time.
 * minutes_left is rounded up; seconds_left (MCP 2.10.1, #673: "minutes_left: 1 with about 10 seconds left") is to the second.
 * A watch party's date airs only when its room is opened, so one with no start time, or whose start time has passed
 * (#839: listed at airs_at yesterday, seconds_left 0, still taking picks), says so in airs_note.
 */
export type AirTiming = {
  airs_at: string | null;
  minutes_left: number | null;
  seconds_left: number | null;
  airs: "scheduled" | "due" | "when_ready" | "watch_party";
  predictions_close: "when_it_airs";
  airs_note?: string;
};

export const WATCH_PARTY_UNSTARTED_NOTE =
  "No start time: it premieres only when someone opens its watch party on /watch, so a pick on it may wait a long while.";
export const WATCH_PARTY_PAST_NOTE =
  "Its listed time has passed and it hasn't aired: it premieres only when someone opens its watch party on /watch, so a pick on it may wait a long while. Predictions stay open until then.";

/** A watch party's date that won't air on its own any time soon: no start time, or one that has passed. */
export const waitsOnRoom = (t: AirTiming, now: Date = new Date()): boolean =>
  t.airs === "watch_party" && (!t.airs_at || new Date(t.airs_at).getTime() <= now.getTime());

export async function airTimings(db: Db, ids: string[], now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<Map<string, AirTiming>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ id: string; status: string; created_at: Date | string; air_after: Date | string | null; party: boolean; party_at: Date | string | null }>(
    `select e.id, e.status, e.created_at, e.air_after, w.id is not null as party, w.starts_at as party_at
       from episodes e left join watch_parties w on w.episode_id = e.id
      where e.id = any($1) and e.revealed_at is null`,
    [ids],
  );
  const minutesTo = (at: Date) => Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 60_000));
  const secondsTo = (at: Date) => Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 1000));
  const left = (at: Date | null) => ({ minutes_left: at ? minutesTo(at) : null, seconds_left: at ? secondsTo(at) : null });
  const out = new Map<string, AirTiming>();
  for (const r of rows) {
    const close = "when_it_airs" as const;
    if (r.party) {
      const at = r.party_at ? new Date(r.party_at) : null;
      const note = !at ? WATCH_PARTY_UNSTARTED_NOTE : at.getTime() <= now.getTime() ? WATCH_PARTY_PAST_NOTE : null;
      out.set(r.id, { airs_at: at ? at.toISOString() : null, ...left(at), airs: "watch_party", predictions_close: close, ...(note ? { airs_note: note } : {}) });
      continue;
    }
    const scheduled = r.air_after ? new Date(r.air_after) : new Date(new Date(r.created_at).getTime() + airWindowMinutes(env) * 60_000);
    if (r.status !== "ready") {
      const at = scheduled.getTime() > now.getTime() ? scheduled : now;
      out.set(r.id, { airs_at: at.toISOString(), ...left(at), airs: "when_ready", predictions_close: close });
    } else if (scheduled.getTime() <= now.getTime()) {
      out.set(r.id, { airs_at: now.toISOString(), minutes_left: 0, seconds_left: 0, airs: "due", predictions_close: close });
    } else {
      out.set(r.id, { airs_at: scheduled.toISOString(), ...left(scheduled), airs: "scheduled", predictions_close: close });
    }
  }
  return out;
}

/** What airs_at, minutes_left and seconds_left mean, said wherever they're listed. */
export const AIR_TIMING_NOTE =
  "airs_at is when it airs on its own; minutes_left is how long from now, rounded up, and seconds_left the same to the second. Predictions stay open until it actually airs (predictions_close: when_it_airs). " +
  "airs: scheduled (at airs_at), due (its time has come: it airs on the next call anyone makes), when_ready (still being written: no sooner than airs_at), watch_party (it premieres in its room, which someone has to open: past its airs_at it can still be open, and airs_note says so).";

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

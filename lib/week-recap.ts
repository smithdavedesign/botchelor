/**
 * The week in review (2026-11-24, David: "A weekly recap episode, 60–90 seconds … make all 3 on the show"): one short
 * video a week of the week's best aired dates, each with how it ended, on its own page (/week) and handed to the
 * social loop.
 *
 * - **The week** is the show's own: Monday 00:00 UTC to the next (lib/season-window.ts weekWindow), named by its Monday
 *   (YYYY-MM-DD). The recap is cut on Sunday evening Pacific, which is already Monday in UTC, so "the last complete
 *   week" is the one that just ended.
 * - **Which dates:** the ranking the Sunday letter and the Discord digest already use (lib/discord-posts.ts bestAired:
 *   the season cast's, then the most called and watched, then the newest), and only dates the home clip would take
 *   (lib/home-clip.ts clipRefusal: aired, public, not hidden by reports, both characters public, the story check hasn't
 *   found its ending contradicting its lines). GET /api/week lists them for the script that cuts the video
 *   (scripts/clips/weekly-recap.mjs).
 * - **The video** is cut on the owner's Mac from those dates' public pages (their own lines, the report cards, the
 *   show's captions) and uploaded here (POST /api/admin/week-recap). One row a week; a second upload replaces it.
 * - **Checked twice**, as the home clip is: the upload refuses a date that isn't public, and every read checks every
 *   date in the cut again, so a date reported away or made private since takes the week's recap off the site until it
 *   is cut again without it.
 * - **Where the bytes go:** the show's own media store (lib/object-store.ts keepBytes, area `clips`), or the row when
 *   none is configured. Read through /api/week-recap/<week>/recap.mp4 and /poster.jpg.
 * - **Switch:** WEEK_RECAP (on unless "0"): the routes and the pages.
 *
 * Nothing here touches a date or makes any media: it is a picture of dates that already aired.
 */
import { bestAired } from "./discord-posts";
import type { Db } from "./db";
import { getEpisodeView, type EpisodeView } from "./game";
import { clipRefusal, STILL_PUBLIC } from "./home-clip";
import { keepBytes, objectStore, readBytes } from "./object-store";
import { overallGrade, type Grade } from "./report-card";
import { dateNumberOf, endingWithDetail, REPORT_HIDE_THRESHOLD } from "./rules";
import { weekWindow } from "./season-window";

export function weekRecapOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.WEEK_RECAP?.trim() !== "0";
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The most dates a week's list names, and the most a recap may hold. */
export const WEEK_DATES = 8;
export const RECAP_MAX_DATES = 8;
/** The most a recap may weigh (the script aims well under 12 MB), run, and its poster weigh. */
export const RECAP_MAX_BYTES = 20_000_000;
export const RECAP_MAX_SECONDS = 100;
export const RECAP_POSTER_MAX_BYTES = 400_000;

export type RecapWeek = { id: string; from: Date; to: Date };

const WEEK_ID = /^\d{4}-\d{2}-\d{2}$/;

/** The week starting on the Monday `id` names (YYYY-MM-DD, UTC), or null when `id` isn't a Monday. */
export function weekOfId(id: string): RecapWeek | null {
  if (!WEEK_ID.test(id)) return null;
  const at = new Date(`${id}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return null;
  const { start, end } = weekWindow(at);
  return start.toISOString().slice(0, 10) === id ? { id, from: start, to: end } : null;
}

/**
 * Which week is meant: nothing, the last complete one; "current", the one `now` is in; else the Monday named. Null for
 * anything else, and for a week that hasn't started.
 */
export function recapWeek(now: Date, which?: string | null): RecapWeek | null {
  const current = weekWindow(now);
  const asked = (which ?? "").trim();
  if (asked === "current") return { id: current.start.toISOString().slice(0, 10), from: current.start, to: current.end };
  if (!asked) {
    const from = new Date(current.start.getTime() - WEEK_MS);
    return { id: from.toISOString().slice(0, 10), from, to: current.start };
  }
  const week = weekOfId(asked);
  return week && week.from.getTime() <= now.getTime() ? week : null;
}

/** "Nov 16 to 22" or "Nov 30 to Dec 6": the week's seven days (UTC), as a heading says them. */
export function weekLabel(week: Pick<RecapWeek, "from" | "to">): string {
  const last = new Date(week.to.getTime() - 1);
  const md = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const sameMonth = week.from.getUTCMonth() === last.getUTCMonth();
  return `${md(week.from)} to ${sameMonth ? last.getUTCDate() : md(last)}`;
}

/** One of a week's dates as the list and the page's cards say it: only what the aired date's own page shows. */
export type WeekDate = {
  id: string;
  title: string | null;
  names: [string, string];
  /** How it ended, as the date's page names it ("A second date", "Just friends · …"). */
  ending: string | null;
  /** Its report card's overall grade (lib/report-card.ts), when it has a box score. */
  grade: Grade | null;
  aired_at: string | null;
};

const iso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

/** A date as a stranger sees it, in the words the list and the cards use. Only for a view clipRefusal passed. */
export function weekDateOf(view: EpisodeView): WeekDate {
  return {
    id: view.id,
    title: view.title ?? null,
    names: [view.characters[0].name, view.characters[1].name],
    ending: view.ending ? endingWithDetail(view.ending, dateNumberOf(view), view.ending_detail) : null,
    grade: view.box_score ? overallGrade(view.box_score) : null,
    aired_at: iso(view.aired_at),
  };
}

/**
 * The week's best aired dates, best first (bestAired's ranking), each one still fit to feature (clipRefusal), at most
 * `n`. A double date's or a mixer's tables count one by one, in the night's own order.
 */
export async function weekBest(db: Db, week: RecapWeek, n: number = WEEK_DATES, now: Date = new Date()): Promise<WeekDate[]> {
  const to = new Date(Math.min(week.to.getTime(), now.getTime()));
  if (to.getTime() <= week.from.getTime()) return [];
  // More than asked: some are turned away below (a private character, a contradicting ending).
  const ranked = await bestAired(db, week.from, to, n * 3, now);
  const ids = [...new Set(ranked.flatMap((item) => item.dates.map((d) => d.id)))].slice(0, n * 3);
  const out: WeekDate[] = [];
  for (const id of ids) {
    if (out.length >= n) break;
    const view = await getEpisodeView(db, id, null).catch(() => null);
    if (view && !clipRefusal(view)) out.push(weekDateOf(view));
  }
  return out;
}

export type WeekRecapInput = {
  week: RecapWeek;
  video: Buffer;
  poster: Buffer;
  width: number;
  height: number;
  seconds: number;
  /** The dates in the cut, in the order they appear. */
  episodes: string[];
};

/** Keeps a week's recap: one a week (an upload for a week that has one replaces it). */
export async function saveWeekRecap(db: Db, r: WeekRecapInput): Promise<{ id: string }> {
  const before = (await db.query<{ mp4_key: string | null; poster_key: string | null }>(`select mp4_key, poster_key from week_recaps where id = $1`, [r.week.id])).rows[0];
  // A new name each time: a kept file is never written over, so a link handed out for the old one never plays the new.
  const stamp = Date.now().toString(36);
  const video = await keepBytes("clips", `week-${r.week.id}-${stamp}-recap`, r.video, "video/mp4");
  const poster = await keepBytes("clips", `week-${r.week.id}-${stamp}-poster`, r.poster, "image/jpeg");
  await db.query(
    `insert into week_recaps (id, week_from, week_to, mp4_key, mp4_data, poster_key, poster_data, width, height, seconds, episodes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     on conflict (id) do update set week_from = excluded.week_from, week_to = excluded.week_to, mp4_key = excluded.mp4_key,
       mp4_data = excluded.mp4_data, poster_key = excluded.poster_key, poster_data = excluded.poster_data, width = excluded.width,
       height = excluded.height, seconds = excluded.seconds, episodes = excluded.episodes, updated_at = now()`,
    [r.week.id, r.week.from.toISOString(), r.week.to.toISOString(), video.object_key, video.data, poster.object_key, poster.data, Math.round(r.width), Math.round(r.height), r.seconds, JSON.stringify(r.episodes)],
  );
  // The files it replaced leave the store too (best effort; the row's trigger queues them as well).
  const gone = [before?.mp4_key, before?.poster_key].filter((k): k is string => Boolean(k));
  const store = gone.length ? objectStore() : null;
  for (const key of gone) if (store) await store.remove(key).catch(() => {});
  return { id: r.week.id };
}

/**
 * Every date in the recap `r` is still one anyone may see ($1 = the report threshold): none deleted, made private,
 * reported away, or with a character gone private since. The read-time half of the rule above.
 */
const ALL_STILL_PUBLIC = `not exists (
        select 1 from jsonb_array_elements_text(r.episodes) as x(episode_id)
          left join episodes e on e.id = x.episode_id
          left join characters a on a.id = e.character_a
          left join characters b on b.id = e.character_b
         where e.id is null or not (${STILL_PUBLIC}))`;

export type WeekRecap = {
  id: string;
  from: string;
  to: string;
  src: string;
  poster_src: string;
  width: number;
  height: number;
  seconds: number;
  episodes: string[];
  updated_at: string;
};

type RecapRow = { id: string; week_from: Date | string; week_to: Date | string; width: number; height: number; seconds: string; episodes: unknown; updated_at: Date | string };

function recapOf(row: RecapRow): WeekRecap {
  // The address changes when the recap is cut again, so nobody keeps playing the one it replaced.
  const v = new Date(row.updated_at).getTime().toString(36);
  return {
    id: row.id,
    from: new Date(row.week_from).toISOString(),
    to: new Date(row.week_to).toISOString(),
    src: `/api/week-recap/${row.id}/recap.mp4?v=${v}`,
    poster_src: `/api/week-recap/${row.id}/poster.jpg?v=${v}`,
    width: row.width,
    height: row.height,
    seconds: Number(row.seconds),
    episodes: Array.isArray(row.episodes) ? row.episodes.filter((x): x is string => typeof x === "string") : [],
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

const RECAP_COLUMNS = `r.id, r.week_from, r.week_to, r.width, r.height, r.seconds, r.episodes, r.updated_at`;

/** One week's recap while every date in it is still public, or null. */
export async function weekRecap(db: Db, id: string): Promise<WeekRecap | null> {
  if (!WEEK_ID.test(id)) return null;
  const row = (await db.query<RecapRow>(`select ${RECAP_COLUMNS} from week_recaps r where r.id = $2 and ${ALL_STILL_PUBLIC}`, [REPORT_HIDE_THRESHOLD, id])).rows[0];
  return row ? recapOf(row) : null;
}

/** The newest week's recap that may still be shown, or null. */
export async function latestWeekRecap(db: Db): Promise<WeekRecap | null> {
  const row = (await db.query<RecapRow>(`select ${RECAP_COLUMNS} from week_recaps r where ${ALL_STILL_PUBLIC} order by r.id desc limit 1`, [REPORT_HIDE_THRESHOLD])).rows[0];
  return row ? recapOf(row) : null;
}

/** The weeks either side of `id` that have a recap to show: the page's "earlier" and "later" links. */
export async function recapNeighbours(db: Db, id: string): Promise<{ previous: string | null; next: string | null }> {
  const { rows } = await db.query<{ previous: string | null; next: string | null }>(
    `select (select max(r.id) from week_recaps r where r.id < $2 and ${ALL_STILL_PUBLIC}) as previous,
            (select min(r.id) from week_recaps r where r.id > $2 and ${ALL_STILL_PUBLIC}) as next`,
    [REPORT_HIDE_THRESHOLD, id],
  );
  return { previous: rows[0]?.previous ?? null, next: rows[0]?.next ?? null };
}

/** The recap's dates as the page's cards show them, in the cut's order: each as a stranger sees it today. */
export async function recapDates(db: Db, recap: Pick<WeekRecap, "episodes">): Promise<{ date: WeekDate; view: EpisodeView }[]> {
  const out: { date: WeekDate; view: EpisodeView }[] = [];
  for (const id of recap.episodes) {
    const view = await getEpisodeView(db, id, null).catch(() => null);
    if (view && !clipRefusal(view)) out.push({ date: weekDateOf(view), view });
  }
  return out;
}

export type RecapFile = { key: string | null; bytes: Buffer | null; mime: "video/mp4" | "image/jpeg" };

/**
 * One of a recap's files, for its route: the store's key when it's there (the route redirects to a signed link), else
 * the bytes. Null when there's no such recap or one of its dates is no longer public.
 */
export async function weekRecapFile(db: Db, id: string, which: "video" | "poster"): Promise<RecapFile | null> {
  if (!WEEK_ID.test(id)) return null;
  const col = which === "video" ? "mp4" : "poster";
  const row = (
    await db.query<{ object_key: string | null; data: Buffer | Uint8Array | null }>(
      `select r.${col}_key as object_key, r.${col}_data as data from week_recaps r where r.id = $2 and ${ALL_STILL_PUBLIC}`,
      [REPORT_HIDE_THRESHOLD, id],
    )
  ).rows[0];
  if (!row) return null;
  const mime = which === "poster" ? "image/jpeg" : "video/mp4";
  if (row.object_key) return { key: row.object_key, bytes: null, mime };
  const bytes = await readBytes(row);
  return bytes ? { key: null, bytes, mime } : null;
}

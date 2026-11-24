/**
 * The clip the home page plays (2026-11-15, the front-door wave: home got 39 visitors for 8 seconds each and showed no
 * video). The show already renders a vertical clip of an aired date every day (scripts/clips/daily-clip.mjs: a screen
 * recording of the theater); that script now also cuts a small muted web loop and a poster and uploads them here
 * (POST /api/admin/home-clip), and a visitor with no character sees the newest one in the hero.
 *
 * - **Only what has aired publicly between public characters**, checked twice: when a clip is uploaded (the route
 *   refuses anything else) and every time it is read (the row is joined to its date, so a date that was reported away,
 *   made private or deleted since, or a character gone private, takes its clip off the home page and its files' routes).
 * - **Fresh or nothing:** a clip older than CLIP_FRESH_DAYS isn't shown; the hero is then what it was.
 * - **Where the bytes go:** the store the show's own media uses (lib/object-store.ts keepBytes, area `clips`), or the
 *   row itself when none is configured. The files are read through /api/home-clip/<id>/loop.mp4 and /poster.jpg.
 * - **Switches:** HOME_HERO_CLIP (on unless "0"): the clip in the hero. HOME_EXPRESS_BOX (on unless "0"): the
 *   one-sentence box under the hero's headline (it also needs EXPRESS_CREATE, lib/express-create.ts).
 * - **The cut** (2026-11-19, the first-minute fixes): the same render, whole and with its voices, cut small for the web,
 *   sent with the loop when the script has it. The episode page offers it as "the 60-second version" (episodeCut), a
 *   quick way in for a viewer who won't sit through the replay; it is the whole date, so its ending too, which is public
 *   once the date has aired (and only an aired date has a clip). Read through /api/home-clip/<id>/cut.mp4.
 * Nothing here touches a date: it is a picture of one that already aired.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { dateNumberSql } from "./date-number";
import { expressCreateOn } from "./express-create";
import type { EpisodeView } from "./game";
import { keepBytes, objectStore, readBytes } from "./object-store";
import { endingLabel, REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { featurableSql, isFeaturable } from "./story-check-gate";

/** A clip this old or older is not "last night's" any more: the hero goes back to what it was. */
export const CLIP_FRESH_DAYS = 14;
/** The most a web loop may weigh (the script aims well under 1.5 MB; this is the route's hard stop) and a poster. */
export const LOOP_MAX_BYTES = 2_500_000;
export const POSTER_MAX_BYTES = 400_000;
/** A loop is a glance, not the date: the script cuts 10 to 14 seconds. */
export const LOOP_MAX_SECONDS = 20;
/** The most a cut may weigh (the script aims well under 12 MB; this is the route's hard stop) and run. */
export const CUT_MAX_BYTES = 20_000_000;
export const CUT_MAX_SECONDS = 150;

export function homeHeroClipOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.HOME_HERO_CLIP?.trim() !== "0";
}

/** The sentence box on home: its own switch, and only while one-sentence create itself is on. */
export function homeExpressBoxOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.HOME_EXPRESS_BOX?.trim() !== "0" && expressCreateOn(env);
}

/**
 * Why a date can't be the home clip, or null when it can: it has aired, it's public, it isn't hidden by reports, and
 * neither character is private. `view` is the date as a stranger sees it (getEpisodeView with no viewer; null: no such
 * date, or a private one). And the story check (lib/story-check-gate.ts) hasn't found its ending contradicting its
 * lines as written (contradicting still, or mended by a repair): such a date is never featured.
 */
export function clipRefusal(view: EpisodeView | null): "episode_not_found" | "not_aired" | "not_public" | "story_contradicts" | null {
  if (!view) return "episode_not_found";
  if (view.visibility !== "public" || view.hidden || view.characters.some((c) => c.private)) return "not_public";
  if (!view.revealed) return "not_aired";
  if (!isFeaturable(view)) return "story_contradicts";
  return null;
}

/** MP4 (an `ftyp` box first) and JPEG (FF D8 FF): the only two files the route keeps. */
export const looksLikeMp4 = (b: Uint8Array) => b.length > 12 && Buffer.from(b.subarray(4, 8)).toString("latin1") === "ftyp";
export const looksLikeJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export type HomeClipInput = {
  episode_id: string;
  day: string;
  loop: Buffer;
  poster: Buffer;
  width: number;
  height: number;
  seconds: number;
  /** The whole clip with its voices (optional): none keeps the cut the date already has. */
  cut?: { bytes: Buffer; seconds: number } | null;
};

/** Keeps a clip: one per date (an upload for a date that has one replaces it, its cut too when one is sent). Returns its id. */
export async function saveHomeClip(db: Db, c: HomeClipInput): Promise<{ id: string }> {
  const id = randomUUID();
  const before = (
    await db.query<{ loop_key: string | null; poster_key: string | null; cut_key: string | null }>(`select loop_key, poster_key, cut_key from home_clips where episode_id = $1`, [c.episode_id])
  ).rows[0];
  const loop = await keepBytes("clips", `${id}-loop`, c.loop, "video/mp4");
  const poster = await keepBytes("clips", `${id}-poster`, c.poster, "image/jpeg");
  const cut = c.cut ? await keepBytes("clips", `${id}-cut`, c.cut.bytes, "video/mp4") : null;
  await db.query(
    `insert into home_clips (id, episode_id, day, loop_key, loop_data, poster_key, poster_data, width, height, seconds, cut_key, cut_data, cut_seconds)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (episode_id) do update set id = excluded.id, day = excluded.day, loop_key = excluded.loop_key, loop_data = excluded.loop_data,
       poster_key = excluded.poster_key, poster_data = excluded.poster_data, width = excluded.width, height = excluded.height,
       seconds = excluded.seconds, created_at = now(),
       cut_key = case when excluded.cut_seconds is null then home_clips.cut_key else excluded.cut_key end,
       cut_data = case when excluded.cut_seconds is null then home_clips.cut_data else excluded.cut_data end,
       cut_seconds = coalesce(excluded.cut_seconds, home_clips.cut_seconds)`,
    [id, c.episode_id, c.day, loop.object_key, loop.data, poster.object_key, poster.data, Math.round(c.width), Math.round(c.height), c.seconds, cut?.object_key ?? null, cut?.data ?? null, c.cut ? c.cut.seconds : null],
  );
  // The files it replaced leave the store too (best effort: a file left behind is only a file nobody links to). A cut
  // that wasn't replaced stays: the row still points at it.
  const gone = [before?.loop_key, before?.poster_key, c.cut ? before?.cut_key : null].filter((k): k is string => Boolean(k));
  const store = gone.length ? objectStore() : null;
  for (const key of gone) if (store) await store.remove(key).catch(() => {});
  return { id };
}

/**
 * The clip's date is still one anyone may see ($1 = the report threshold): aired, ready, public, not reported away,
 * both characters public. Needs `e`, `a`, `b`. The read-time half of the rule above.
 */
export const STILL_PUBLIC = `e.revealed_at is not null and e.status = 'ready' and e.visibility = 'public'
        and a.visibility = 'public' and b.visibility = 'public'
        and (select count(*) from reports r where r.episode_id = e.id) < $1::int`;

export type HomeClip = {
  id: string;
  episode_id: string;
  /** The date's replay: its page, opening the theater. */
  watch_href: string;
  loop_src: string;
  poster_src: string;
  width: number;
  height: number;
  seconds: number;
  names: [string, string];
  /** How it ended, as the date itself reads it ("A second date"): public, because the date has aired. */
  ending: string | null;
};

/**
 * The newest clip of the last CLIP_FRESH_DAYS whose date is still public and featurable (the story check hasn't found
 * its ending contradicting its lines as written: lib/story-check-gate.ts), or null. One query: an older fresh clip
 * stands in for a contradicting newest one.
 */
export async function latestHomeClip(db: Db, now: Date = new Date()): Promise<HomeClip | null> {
  const row = (
    await db.query<{ id: string; episode_id: string; width: number; height: number; seconds: string; a_name: string; b_name: string; ending: Ending | null; date_number: number | null }>(
      `select c.id, c.episode_id, c.width, c.height, c.seconds, a.name as a_name, b.name as b_name, e.ending, ${dateNumberSql("e")} as date_number
         from home_clips c
         join episodes e on e.id = c.episode_id
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where c.created_at > $2::timestamptz - make_interval(days => $3::int) and ${STILL_PUBLIC} and ${featurableSql("e")}
        order by c.created_at desc
        limit 1`,
      [REPORT_HIDE_THRESHOLD, now.toISOString(), CLIP_FRESH_DAYS],
    )
  ).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    episode_id: row.episode_id,
    watch_href: `/episodes/${row.episode_id}?play=1`,
    loop_src: `/api/home-clip/${row.id}/loop.mp4`,
    poster_src: `/api/home-clip/${row.id}/poster.jpg`,
    width: row.width,
    height: row.height,
    seconds: Number(row.seconds),
    names: [row.a_name, row.b_name],
    ending: row.ending ? endingLabel(row.ending, row.date_number) : null,
  };
}

/**
 * The newest clip kept for one date, while the date is still public and featurable, or null: what the episode page's
 * link card plays as its video (og:video, 2026-11-18). Any age: it's that date's own clip, not "last night's". The loop
 * is the date's opening lines, never its ending, so the card still asks how it ends.
 */
export async function episodeClip(db: Db, episodeId: string): Promise<Pick<HomeClip, "id" | "loop_src" | "poster_src" | "width" | "height"> | null> {
  const row = (
    await db.query<{ id: string; width: number; height: number }>(
      `select c.id, c.width, c.height
         from home_clips c
         join episodes e on e.id = c.episode_id
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where c.episode_id = $2 and ${STILL_PUBLIC} and ${featurableSql("e")}
        order by c.created_at desc
        limit 1`,
      [REPORT_HIDE_THRESHOLD, episodeId],
    )
  ).rows[0];
  return row ? { id: row.id, loop_src: `/api/home-clip/${row.id}/loop.mp4`, poster_src: `/api/home-clip/${row.id}/poster.jpg`, width: row.width, height: row.height } : null;
}

/** A date's cut, for its page: the whole clip with its voices, its poster, and how long it runs. */
export type EpisodeCut = { id: string; src: string; poster_src: string; seconds: number };

/**
 * The cut kept for one date, while the date is still public and featurable, or null: the episode page's "60-second
 * version" (the theater's cold open offers it too). Any age, like episodeClip.
 */
export async function episodeCut(db: Db, episodeId: string): Promise<EpisodeCut | null> {
  const row = (
    await db.query<{ id: string; cut_seconds: string }>(
      `select c.id, c.cut_seconds
         from home_clips c
         join episodes e on e.id = c.episode_id
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where c.episode_id = $2 and c.cut_seconds is not null and (c.cut_key is not null or c.cut_data is not null)
          and ${STILL_PUBLIC} and ${featurableSql("e")}
        order by c.created_at desc
        limit 1`,
      [REPORT_HIDE_THRESHOLD, episodeId],
    )
  ).rows[0];
  return row ? { id: row.id, src: `/api/home-clip/${row.id}/cut.mp4`, poster_src: `/api/home-clip/${row.id}/poster.jpg`, seconds: Number(row.cut_seconds) } : null;
}

/**
 * The line under the clip: who, and how it ended when that is public (it is, once the date has aired). "How it ended: a
 * fifth date", in a sentence's case (2026-11-22 audit: "It ended: A fifth date" read as two headings).
 */
export function clipCaption(clip: Pick<HomeClip, "names" | "ending">): string {
  const pair = `${clip.names[0]} × ${clip.names[1]}`;
  if (!clip.ending) return pair;
  return `${pair} · How it ended: ${clip.ending.charAt(0).toLowerCase()}${clip.ending.slice(1)}`;
}

export type ClipFile = { key: string | null; bytes: Buffer | null; mime: "video/mp4" | "image/jpeg" };

/**
 * One of a clip's files (loop, poster, cut), for its route: the store's key when it's there (the route redirects to a signed link), else
 * the bytes. Null when there's no such clip or its date is no longer public.
 */
export async function homeClipFile(db: Db, id: string, which: "loop" | "poster" | "cut"): Promise<ClipFile | null> {
  const col = which === "loop" ? "loop" : which === "cut" ? "cut" : "poster";
  const row = (
    await db.query<{ object_key: string | null; data: Buffer | Uint8Array | null }>(
      `select c.${col}_key as object_key, c.${col}_data as data
         from home_clips c
         join episodes e on e.id = c.episode_id
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where c.id = $2 and ${STILL_PUBLIC}`,
      [REPORT_HIDE_THRESHOLD, id],
    )
  ).rows[0];
  if (!row) return null;
  const mime = which === "poster" ? "image/jpeg" : "video/mp4";
  if (row.object_key) return { key: row.object_key, bytes: null, mime };
  const bytes = await readBytes(row);
  return bytes ? { key: null, bytes, mime } : null;
}

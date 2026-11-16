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
 * lines: such a date is never featured.
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

export type HomeClipInput = { episode_id: string; day: string; loop: Buffer; poster: Buffer; width: number; height: number; seconds: number };

/** Keeps a clip: one per date (an upload for a date that has one replaces it). Returns its id. */
export async function saveHomeClip(db: Db, c: HomeClipInput): Promise<{ id: string }> {
  const id = randomUUID();
  const before = (await db.query<{ loop_key: string | null; poster_key: string | null }>(`select loop_key, poster_key from home_clips where episode_id = $1`, [c.episode_id])).rows[0];
  const loop = await keepBytes("clips", `${id}-loop`, c.loop, "video/mp4");
  const poster = await keepBytes("clips", `${id}-poster`, c.poster, "image/jpeg");
  await db.query(
    `insert into home_clips (id, episode_id, day, loop_key, loop_data, poster_key, poster_data, width, height, seconds)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (episode_id) do update set id = excluded.id, day = excluded.day, loop_key = excluded.loop_key, loop_data = excluded.loop_data,
       poster_key = excluded.poster_key, poster_data = excluded.poster_data, width = excluded.width, height = excluded.height,
       seconds = excluded.seconds, created_at = now()`,
    [id, c.episode_id, c.day, loop.object_key, loop.data, poster.object_key, poster.data, Math.round(c.width), Math.round(c.height), c.seconds],
  );
  // The clip it replaced leaves the store too (best effort: a file left behind is only a file nobody links to).
  const store = before?.loop_key || before?.poster_key ? objectStore() : null;
  for (const key of [before?.loop_key, before?.poster_key]) if (store && key) await store.remove(key).catch(() => {});
  return { id };
}

/**
 * The clip's date is still one anyone may see ($1 = the report threshold): aired, ready, public, not reported away,
 * both characters public. Needs `e`, `a`, `b`. The read-time half of the rule above.
 */
const STILL_PUBLIC = `e.revealed_at is not null and e.status = 'ready' and e.visibility = 'public'
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
 * its ending contradicting its lines: lib/story-check-gate.ts), or null. One query: an older fresh clip stands in for a
 * contradicting newest one.
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

/** The line under the clip: who, and how it ended when that is public (it is, once the date has aired). */
export function clipCaption(clip: Pick<HomeClip, "names" | "ending">): string {
  const pair = `${clip.names[0]} × ${clip.names[1]}`;
  return clip.ending ? `${pair} · It ended: ${clip.ending}` : pair;
}

export type ClipFile = { key: string | null; bytes: Buffer | null; mime: "video/mp4" | "image/jpeg" };

/**
 * One of a clip's two files, for its route: the store's key when it's there (the route redirects to a signed link), else
 * the bytes. Null when there's no such clip or its date is no longer public.
 */
export async function homeClipFile(db: Db, id: string, which: "loop" | "poster"): Promise<ClipFile | null> {
  const col = which === "loop" ? "loop" : "poster";
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
  const mime = which === "loop" ? "video/mp4" : "image/jpeg";
  if (row.object_key) return { key: row.object_key, bytes: null, mime };
  const bytes = await readBytes(row);
  return bytes ? { key: null, bytes, mime } : null;
}

/**
 * The Daily Date (/daily): one house-vs-house date a UTC day, the same for everyone, to predict without an account.
 *
 * The pool is the house cast's own dates that already aired publicly: the lobby films one or more a day
 * (lib/watch.ts refreshLobby), and a date that aired gives nothing away that the show hasn't (an unaired one is still
 * open for points on its own page, so it never comes here). Each day's date is dealt on the day's first read (a
 * visitor, or the hourly lobby job) and stored in daily_dates, so the same day always serves the same date, and a
 * stored day never needs a model or anything but the database. The deal is the day's seeded pick (lib/engine.ts
 * seedFrom) among the pool's dates no earlier day has had, oldest first; once all have had a day, any but yesterday's.
 *
 * Two read models, on purpose: dailyCard is what the page shows before a pick (the two public sheets and where they
 * met), and it never selects the ending or the scenes, so the page can't leak them; dailyStory is the whole date, for
 * after a pick (dailyReveal, POST /api/daily) and for a past day (/daily/{n}).
 */
import { portraitPathSql } from "./assets";
import { publicDateSql } from "./date-number";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { getEpisodeView } from "./game";
import { endingLabel } from "./rules";
import type { DailyReveal, DailyStory } from "./daily-shared";
import type { Ending } from "./rules";

/**
 * The house cast's public, aired dates (the public layer: lib/date-number.ts publicDateSql) with scenes to tell. The
 * scenes test can't throw (jsonb_array_length does on a non-array, and SQL doesn't promise which test runs first).
 */
const POOL_WHERE = (e: string, a: string, b: string) =>
  `${a}.is_house and ${b}.is_house and ${a}.visibility = 'public' and ${b}.visibility = 'public'
   and ${publicDateSql(e)} and jsonb_typeof(${e}.scenes) = 'array' and ${e}.scenes <> '[]'::jsonb`;

/** Every date the Daily Date may deal, oldest first (ids only: the pool is read on a day's first visit). */
export async function dailyPool(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select e.id from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where ${POOL_WHERE("e", "a", "b")}
      order by e.created_at, e.id`,
  );
  return rows.map((r) => r.id);
}

/**
 * Day n's date from the pool, deterministically: the day's seeded pick among the dates no day has had yet, and once
 * every date has had one, among all of them but yesterday's (unless it's the only one). Null for an empty pool.
 */
export function chooseDaily(pool: readonly string[], used: ReadonlySet<string>, yesterday: string | null, n: number): string | null {
  const fresh = pool.filter((id) => !used.has(id));
  const candidates = fresh.length ? fresh : pool.length > 1 ? pool.filter((id) => id !== yesterday) : [...pool];
  if (!candidates.length) return null;
  return candidates[seedFrom("daily-date", n) % candidates.length];
}

/** Day n's stored date, and whether it's still in the pool (a date can be reported off the air, or made private). */
async function stored(db: Db, n: number): Promise<{ episode_id: string; live: boolean } | null> {
  const { rows } = await db.query<{ episode_id: string; live: boolean }>(
    `select d.episode_id, (${POOL_WHERE("e", "a", "b")}) as live
       from daily_dates d
       join episodes e on e.id = d.episode_id
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where d.day_number = $1`,
    [n],
  );
  return rows[0] ?? null;
}

/** Day n's date as stored, if it's still on the air. Never deals one: a day nobody dealt has none. */
export async function dailyEpisodeId(db: Db, n: number): Promise<string | null> {
  const day = await stored(db, n);
  return day?.live ? day.episode_id : null;
}

/**
 * Day n's date, dealing it if this is the day's first read. Only for today (the page, the hourly job and the reveal
 * call it with today's number): a past day keeps what it had. If today's date was taken off the air after it was
 * dealt, today is dealt again, once, by an update that only lands if the day still holds that date.
 */
export async function ensureDailyEpisodeId(db: Db, n: number): Promise<string | null> {
  if (!Number.isInteger(n) || n < 1) return null;
  const day = await stored(db, n);
  if (day?.live) return day.episode_id;
  const pool = await dailyPool(db);
  const used = new Set((await db.query<{ episode_id: string }>(`select episode_id from daily_dates`)).rows.map((r) => r.episode_id));
  const pick = chooseDaily(pool, used, n > 1 ? await dailyEpisodeId(db, n - 1) : null, n);
  if (!pick) return null;
  if (day) {
    await db.query(`update daily_dates set episode_id = $2, dealt_at = now() where day_number = $1 and episode_id = $3`, [n, pick, day.episode_id]);
  } else {
    // The day number is the key: if another first read dealt it a moment ago, this one keeps theirs.
    await db.query(`insert into daily_dates (day_number, episode_id) values ($1, $2) on conflict (day_number) do nothing`, [n, pick]);
  }
  return dailyEpisodeId(db, n);
}

/** One house character's public card, as its own page shows it (no dealbreaker: that stays the show's secret). */
export type DailySheet = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: string[];
  want: string;
  appearance: string | null;
  hue: number | null;
  portrait: string | null;
};

/** What the page shows before a pick: the two sheets and where they met. Nothing that says how it ends. */
export type DailyCard = { setting: string; characters: [DailySheet, DailySheet] };

export async function dailyCard(db: Db, episodeId: string): Promise<DailyCard | null> {
  const sheet = (x: string) =>
    `json_build_object('id', ${x}.id, 'name', ${x}.name, 'age', ${x}.age, 'bio', ${x}.bio, 'traits', ${x}.traits, 'want', ${x}.want,
                       'appearance', ${x}.appearance, 'hue', ${x}.avatar_hue, 'portrait', ${portraitPathSql(x)})`;
  const { rows } = await db.query<{ setting: string; a: DailySheet; b: DailySheet }>(
    `select e.setting, ${sheet("a")} as a, ${sheet("b")} as b
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1`,
    [episodeId],
  );
  const row = rows[0];
  return row ? { setting: row.setting, characters: [row.a, row.b] } : null;
}

/**
 * The whole date for day n, as a logged-out spectator sees it once it has aired (lib/game.ts getEpisodeView): the
 * ending, the scenes, the best line and why it ended that way. Null if it's gone or hidden.
 */
export async function dailyStory(db: Db, n: number, episodeId: string): Promise<DailyStory | null> {
  const view = await getEpisodeView(db, episodeId, null);
  if (!view || view.hidden || !view.ending || !view.scenes) return null;
  return {
    n,
    ending: view.ending,
    ending_label: endingLabel(view.ending, view.date_number),
    scenes: view.scenes,
    finale: view.finale ?? "",
    best_line: view.best_line ?? null,
    why: view.why ?? null,
    episode_path: view.share_path,
    names: [view.characters[0].name, view.characters[1].name],
  };
}

/** Day n's date with a visitor's pick scored against it. Nothing about the visitor is kept. */
export async function dailyReveal(db: Db, n: number, episodeId: string, pick: Ending): Promise<DailyReveal | null> {
  const story = await dailyStory(db, n, episodeId);
  return story ? { ...story, pick, correct: pick === story.ending } : null;
}

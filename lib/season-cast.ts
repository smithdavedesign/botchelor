/**
 * This season's house cast. The show is about the characters people and agents make, so the house only
 * fields a handful a season (a season is a month, lib/season-window.ts): they're the ones you can date by name, the
 * blind-date fallback, the lobby's always-on rooms and the ones the site features. The rest of the roster
 * sits the season out — their cards and past dates stay up, but nobody can book them.
 *
 * Who's on is decided once, on the season's first read, and stored (season_casts): the previous season's two most-loved
 * (lib/reviews.ts popularity) stay on, and newcomers fill the rest (David, 2026-10-19). The first monthly season kept
 * the cast the old seeded shuffle had dealt it. Until the stored cast is loaded (refreshSeasonCast, run from getDb),
 * the shuffle stands in. BOTCHELOR_SEASON_CAST (comma-separated house ids) pins a hand-picked cast instead, and
 * BOTCHELOR_SEASON_CAST_SIZE changes how many there are. Premium house characters are separate: whoever
 * bought one keeps them, every season.
 */
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { HOUSE_CHARACTERS, type HouseCharacter } from "./house";
import { popularity } from "./reviews";
import { MONTHLY_FROM, previousSeasonStart, seasonIdOf, seasonWindow } from "./season-window";

export const DEFAULT_SEASON_CAST_SIZE = 4;

/** The season's id: the day it starts, YYYY-MM-DD (UTC). The same value as seasonAt(now).id in lib/seasons.ts. */
export function seasonIdAt(now: Date): string {
  return seasonIdOf(now);
}

let override: string[] | null = null;
/** Tests pin the cast (null = the real rotation). */
export function setSeasonCastForTests(ids: string[] | null): void {
  override = ids;
}

const ROSTER = HOUSE_CHARACTERS.map((c) => c.id);

export function seasonCastSize(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.BOTCHELOR_SEASON_CAST_SIZE?.trim());
  // At least two, so the lobby can always pair a house date.
  return Number.isFinite(n) && n >= 2 ? Math.min(Math.floor(n), ROSTER.length) : DEFAULT_SEASON_CAST_SIZE;
}

/** The seeded shuffle of the roster for a season: the cast before seasons were stored, and the stand-in until then. */
function dealt(season: string, size: number): string[] {
  const ids = [...ROSTER];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = seedFrom("season-cast", season, i) % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, size);
}

/** The stored cast this instance has loaded, and when (refreshSeasonCast). */
let stored: { season: string; ids: string[]; at: number } | null = null;
const FRESH_MS = 60_000;

/** The house ids on this season's show, in billing order. */
export function seasonCastIds(now: Date = new Date(), env: Record<string, string | undefined> = process.env): string[] {
  if (override) return override;
  const pinned = (env.BOTCHELOR_SEASON_CAST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((id) => ROSTER.includes(id));
  if (pinned.length >= 2) return [...new Set(pinned)];
  const season = seasonIdAt(now);
  if (stored?.season === season && stored.ids.length >= 2) return stored.ids;
  return dealt(season, seasonCastSize(env));
}

/** How many of a season's cast stay on for the next (David: "top 2 survive a new season"). */
export const SURVIVORS = 2;

export type CastSlot = { character_id: string; slot: number; source: "dealt" | "survivor" | "new" };

async function storedCast(db: Db, season: string): Promise<CastSlot[]> {
  return (await db.query<CastSlot>(`select character_id, slot::int as slot, source from season_casts where season_id = $1 order by slot`, [season])).rows;
}

/**
 * Who fills a season's open places after the survivors: the season's generated newcomers (lib/season-gen.ts), and if
 * there aren't enough of them, the roster in the season's dealt order, preferring whoever sat the last season out.
 */
async function newcomers(db: Db, season: string, places: number, last: string[], taken: string[]): Promise<string[]> {
  // Imported here: lib/season-gen.ts reads this module's sizes.
  const { takeNewcomers } = await import("./season-gen");
  const generated = (await takeNewcomers(db, season, places)).filter((id) => !taken.includes(id));
  const order = dealt(season, ROSTER.length);
  const fresh = order.filter((id) => !last.includes(id) && !taken.includes(id));
  const rest = order.filter((id) => last.includes(id) && !taken.includes(id));
  return [...generated, ...fresh, ...rest].slice(0, places);
}

/** Picks a season's cast: the first monthly season keeps its dealt cast; after it, two survivors and newcomers. */
async function pickCast(db: Db, now: Date, size: number): Promise<CastSlot[]> {
  const { start } = seasonWindow(now);
  const season = seasonIdOf(now);
  if (start.getTime() <= MONTHLY_FROM) return dealt(season, size).map((character_id, slot) => ({ character_id, slot, source: "dealt" }));
  const lastStart = previousSeasonStart(now);
  const lastId = seasonIdOf(lastStart);
  const lastCast = (await storedCast(db, lastId)).map((c) => c.character_id);
  const last = lastCast.length ? lastCast : dealt(lastId, size);
  const ranked = await popularity(db, last, lastStart, start);
  const survivors = ranked.slice(0, Math.min(SURVIVORS, size)).map((p) => p.id);
  const added = await newcomers(db, season, size - survivors.length, last, survivors);
  return [
    ...survivors.map((character_id, slot) => ({ character_id, slot, source: "survivor" as const })),
    ...added.map((character_id, i) => ({ character_id, slot: survivors.length + i, source: "new" as const })),
  ];
}

/**
 * The season's stored cast, choosing it on the season's first read. One caller claims the rotation
 * (season_cast_rotations) so two cold starts can't pick two casts; the other gets what the first stored, or, in the
 * moment before it lands, nothing (and the caller keeps the stand-in).
 */
export async function ensureSeasonCast(db: Db, now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<CastSlot[]> {
  const season = seasonIdOf(now);
  const have = await storedCast(db, season);
  if (have.length) return have;
  const claimed = (await db.query(`insert into season_cast_rotations (season_id) values ($1) on conflict do nothing returning season_id`, [season])).rows.length > 0;
  if (!claimed) return storedCast(db, season);
  const picks = await pickCast(db, now, seasonCastSize(env));
  for (const p of picks) {
    await db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, $3, $4) on conflict do nothing`, [season, p.character_id, p.slot, p.source]);
  }
  return picks;
}

/** Loads this season's stored cast into memory for seasonCastIds, at most once a minute; run from getDb. */
export async function refreshSeasonCast(db: Db, now: Date = new Date()): Promise<void> {
  const season = seasonIdOf(now);
  if (stored?.season === season && Date.now() - stored.at < FRESH_MS) return;
  const cast = await ensureSeasonCast(db, now);
  stored = { season, ids: cast.map((c) => c.character_id), at: Date.now() };
}

/** Tests: forget the loaded cast. */
export function resetStoredSeasonCastForTests(): void {
  stored = null;
}

export type CastCard = { id: string; name: string; age: number; bio: string; traits: readonly string[]; archetype: string; hue: number };

/** This season's house cast as cards, from the database, so a generated newcomer (lib/season-gen.ts) shows too. */
export async function seasonCastCards(db: Db, now: Date = new Date()): Promise<CastCard[]> {
  const ids = seasonCastIds(now);
  const { rows } = await db.query<{ id: string; name: string; age: number; bio: string; traits: string[]; hue: number | null; archetype: string | null }>(
    `select c.id, c.name, c.age, c.bio, c.traits, c.avatar_hue as hue, sc.archetype
       from characters c left join season_candidates sc on sc.character_id = c.id
      where c.id = any($1)`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const house = HOUSE_CHARACTERS.find((c) => c.id === id);
    return [{ id, name: r.name, age: r.age, bio: r.bio, traits: r.traits, archetype: house?.archetype ?? r.archetype ?? "The newcomer", hue: r.hue ?? house?.hue ?? 200 }];
  });
}

/** This season's house characters, in billing order (the code-defined ones only: seasonCastCards has everyone). */
export function seasonCast(now: Date = new Date()): HouseCharacter[] {
  return seasonCastIds(now)
    .map((id) => HOUSE_CHARACTERS.find((c) => c.id === id))
    .filter((c): c is HouseCharacter => Boolean(c));
}

export function isOnSeasonCast(id: string, now: Date = new Date()): boolean {
  return seasonCastIds(now).includes(id);
}

/**
 * The last season before this one that each of these was on the stored cast (season_casts), by id: for saying who left
 * with which month (#1132, "From October's cast"). Missing for anyone never stored on a cast (a pinned cast, a test).
 */
export async function lastSeasonOn(db: Db, ids: readonly string[], now: Date = new Date()): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ character_id: string; season_id: string }>(
    `select character_id, max(season_id) as season_id from season_casts where character_id = any($1) and season_id < $2 group by character_id`,
    [[...ids], seasonIdAt(now)],
  );
  return new Map(rows.map((r) => [r.character_id, r.season_id]));
}

/** A season's month by name ("October"), from its id. A weekly season's is the month its Monday fell in. */
export const seasonMonth = (id: string): string => new Date(`${id}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

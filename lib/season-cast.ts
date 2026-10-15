/**
 * This season's house cast. The show is about the characters people and agents make, so the house only
 * fields a handful a season (a season is a week, lib/seasons.ts): they're the ones you can date by name, the
 * blind-date fallback, the lobby's always-on rooms and the ones the site features. The rest of the roster
 * sits the season out — their cards and past dates stay up, but nobody can book them.
 *
 * Who's on is dealt from the season's id by a seeded shuffle, so it rotates every Monday and is the same for
 * everyone all week. BOTCHELOR_SEASON_CAST (comma-separated house ids) pins a hand-picked cast instead, and
 * BOTCHELOR_SEASON_CAST_SIZE changes how many are dealt. Premium house characters are separate: whoever
 * bought one keeps them, every season.
 */
import { seedFrom } from "./engine";
import { HOUSE_CHARACTERS, type HouseCharacter } from "./house";

export const DEFAULT_SEASON_CAST_SIZE = 4;

/**
 * The season's id: the Monday (UTC) it starts, as YYYY-MM-DD. The same value as seasonAt(now).id in
 * lib/seasons.ts (a test holds them together); computed here because seasons.ts imports game.ts, which
 * imports mechanics.ts, which uses this module.
 */
export function seasonIdAt(now: Date): string {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(midnight - daysSinceMonday * 86_400_000).toISOString().slice(0, 10);
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

/** The house ids on this season's show, in billing order. */
export function seasonCastIds(now: Date = new Date(), env: Record<string, string | undefined> = process.env): string[] {
  if (override) return override;
  const pinned = (env.BOTCHELOR_SEASON_CAST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((id) => ROSTER.includes(id));
  if (pinned.length >= 2) return [...new Set(pinned)];
  const season = seasonIdAt(now);
  const ids = [...ROSTER];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = seedFrom("season-cast", season, i) % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, seasonCastSize(env));
}

/** This season's house characters, in billing order. */
export function seasonCast(now: Date = new Date()): HouseCharacter[] {
  return seasonCastIds(now)
    .map((id) => HOUSE_CHARACTERS.find((c) => c.id === id))
    .filter((c): c is HouseCharacter => Boolean(c));
}

export function isOnSeasonCast(id: string, now: Date = new Date()): boolean {
  return seasonCastIds(now).includes(id);
}

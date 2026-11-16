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
 *
 * Fan picks (lib/auditions.ts; David, 2026-11-03: "ideally real people's characters instead of bots"): people's own
 * characters that auditioned and were shortlisted take the open places after the survivors, by votes, before any
 * generated newcomer, leaving the house at least HOUSE_MIN places. seasonCastIds stays the HOUSE cast (After Dark,
 * Shorts, step-in, the blind-date fallback and the recoupling run on house characters only); seasonFanCastIds is the
 * fan picks still on (not withdrawn, still public and open to dates, still their owner's); showCastIds is both, for
 * what the audience sees and plays with: the cast cards, the lobby's dates, backing and the group chat.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { HOUSE_CHARACTERS, type HouseCharacter } from "./house";
import { popularity } from "./reviews";
import { MONTHLY_FROM, previousSeasonStart, seasonIdOf, seasonWindow } from "./season-window";

export const DEFAULT_SEASON_CAST_SIZE = 4;
/** The house places a season always keeps, whatever the auditions: the lobby and the blind-date fallback need two. */
export const HOUSE_MIN = 2;

/** The season's id: the day it starts, YYYY-MM-DD (UTC). The same value as seasonAt(now).id in lib/seasons.ts. */
export function seasonIdAt(now: Date): string {
  return seasonIdOf(now);
}

let override: string[] | null = null;
let fanOverride: string[] | null = null;
let leadForTests: string | null = null;
/** Tests pin the cast (null = the real rotation), the fan picks with it (none unless given), and a Botchelor lead. */
export function setSeasonCastForTests(ids: string[] | null, fans: string[] | null = null, lead: string | null = null): void {
  override = ids;
  fanOverride = fans;
  leadForTests = lead;
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

/**
 * A house challenge's prize (lib/house-conflict.ts, house_prizes): on `day`, the one-on-one goes to the challenge's
 * winner. 'lead_date' (a Botchelor season): the winner takes the lead's date that day and gives up their own next
 * turn to whoever's day it was (suitorInTurn), so no date is added and nobody dates the lead less. 'first_pick' (any
 * other format): the day's first house date is the winner's, with the partner they picked (firstPickOn).
 */
export type HousePrize = { day: string; winner: string; with: string | null; kind: "lead_date" | "first_pick"; title: string | null; scene: string | null };

let prizesForTests: HousePrize[] | null = null;
/** Tests pin the season's prizes (null = what the loaded cast holds). */
export function setHousePrizesForTests(prizes: HousePrize[] | null): void {
  prizesForTests = prizes;
}

/** This season's challenge prizes, from the loaded cast (sync, like seasonCastIds). */
export function housePrizes(now: Date = new Date()): HousePrize[] {
  if (prizesForTests) return prizesForTests;
  return stored?.season === seasonIdAt(now) ? stored.prizes : [];
}

/** The prize on a UTC day, if a challenge gave one. */
export function housePrizeOn(day: string): HousePrize | null {
  return housePrizes(new Date(`${day}T12:00:00.000Z`)).find((p) => p.day === day) ?? null;
}

/**
 * On a season without a lead: the two on the day's first house date when a challenge's winner has first pick of it
 * (the winner, then the partner they picked), as long as both are still among `cast`. Null otherwise: the day deals
 * its pair as always.
 */
export function firstPickOn(day: string, cast: readonly string[]): [string, string] | null {
  const p = housePrizeOn(day);
  if (!p || p.kind !== "first_pick" || !p.with || p.with === p.winner) return null;
  return cast.includes(p.winner) && cast.includes(p.with) ? [p.winner, p.with] : null;
}

/**
 * The stored cast this instance has loaded, and when (refreshSeasonCast): the house ids, the fan picks still on, and
 * on a Botchelor season the lead (lib/ceremony.ts).
 */
let stored: { season: string; ids: string[]; fans: string[]; lead: string | null; prizes: HousePrize[]; at: number } | null = null;
const FRESH_MS = 60_000;

/** The house ids on this season's show, in billing order (the fan picks: seasonFanCastIds). */
export function seasonCastIds(now: Date = new Date(), env: Record<string, string | undefined> = process.env): string[] {
  if (override) return override;
  const pinned = (env.BOTCHELOR_SEASON_CAST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((id) => ROSTER.includes(id));
  if (pinned.length >= 2) return [...new Set(pinned)];
  const season = seasonIdAt(now);
  // A classic cast always has HOUSE_MIN house places; a Botchelor season's house side is its one lead (lib/ceremony.ts).
  if (stored?.season === season && stored.ids.length >= 1) return stored.ids;
  return dealt(season, seasonCastSize(env));
}

/** People's characters on this season's show (lib/auditions.ts), still on: withdrawn or gone private, they're off. */
export function seasonFanCastIds(now: Date = new Date()): string[] {
  if (override) return fanOverride ?? [];
  const season = seasonIdAt(now);
  return stored?.season === season ? stored.fans : [];
}

/** Everyone on this season's show as the audience meets them: the house cast, then the fan picks. */
export function showCastIds(now: Date = new Date()): string[] {
  return [...seasonCastIds(now), ...seasonFanCastIds(now)];
}

export function isFanCast(id: string, now: Date = new Date()): boolean {
  return seasonFanCastIds(now).includes(id);
}

/** How many of a season's cast stay on for the next (David: "top 2 survive a new season"). */
export const SURVIVORS = 2;

export type CastSource = "dealt" | "survivor" | "new" | "fan" | "lead" | "suitor";
export type CastSlot = { character_id: string; slot: number; source: CastSource };

/** A season's stored cast by who's who: house characters, the fan picks (and suitors) still on, and the lead if any. */
async function castKinds(db: Db, season: string): Promise<{ house: string[]; fans: string[]; lead: string | null }> {
  const { rows } = await db.query<{ character_id: string; is_house: boolean; is_on: boolean; source: CastSource }>(
    `select s.character_id, c.is_house, s.source,
            (s.withdrawn_at is null and c.visibility = 'public' and c.open_to_dates and c.owner_id is distinct from 'deleted') as is_on
       from season_casts s join characters c on c.id = s.character_id
      where s.season_id = $1 order by s.slot`,
    [season],
  );
  return {
    house: rows.filter((r) => r.is_house).map((r) => r.character_id),
    fans: rows.filter((r) => !r.is_house && r.is_on).map((r) => r.character_id),
    lead: rows.find((r) => r.source === "lead")?.character_id ?? null,
  };
}

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

/**
 * Picks a season's cast: the first monthly season keeps its dealt cast; after it, two survivors, then the shortlisted
 * auditions by votes (lib/auditions.ts) up to what leaves the house HOUSE_MIN places, then house newcomers.
 */
async function pickCast(db: Db, now: Date, size: number): Promise<CastSlot[]> {
  const { start } = seasonWindow(now);
  const season = seasonIdOf(now);
  if (start.getTime() <= MONTHLY_FROM) return dealt(season, size).map((character_id, slot) => ({ character_id, slot, source: "dealt" }));
  const lastStart = previousSeasonStart(now);
  const lastId = seasonIdOf(lastStart);
  const lastKinds = await castKinds(db, lastId);
  const lastCast = [...lastKinds.house, ...lastKinds.fans];
  const last = lastCast.length ? lastCast : dealt(lastId, size);
  const ranked = await popularity(db, last, lastStart, start);
  // A lead format (The Botchelor): the lead, then the suitors; imported here, lib/season-format-store.ts reads the ballot.
  const { seasonFormatSlug } = await import("./season-format-store");
  const { seasonFormat } = await import("./season-format");
  const def = seasonFormat(await seasonFormatSlug(db, season).catch(() => null));
  if (def.lead) {
    const houseRanked = ranked.map((p) => p.id).filter((id) => lastKinds.house.includes(id) || ROSTER.includes(id));
    return pickLeadCast(db, season, def.lead, houseRanked.length ? houseRanked : dealt(lastId, size));
  }
  const survivors = ranked.slice(0, Math.min(SURVIVORS, size)).map((p) => p.id);
  const fanSurvivors = survivors.filter((id) => lastKinds.fans.includes(id)).length;
  const { shortlist } = await import("./auditions");
  const fans = (await shortlist(db, season)).filter((id) => !survivors.includes(id)).slice(0, Math.max(0, size - HOUSE_MIN - fanSurvivors));
  const taken = [...survivors, ...fans];
  const added = await newcomers(db, season, size - taken.length, last, taken);
  return [
    ...survivors.map((character_id, slot) => ({ character_id, slot, source: "survivor" as const })),
    ...fans.map((character_id, i) => ({ character_id, slot: survivors.length + i, source: "fan" as const })),
    ...added.map((character_id, i) => ({ character_id, slot: taken.length + i, source: "new" as const })),
  ];
}

/**
 * A Botchelor season's cast (lib/season-format.ts LeadRule; lib/ceremony.ts): the lead, then the suitors.
 *  - The lead: the admin's pick for the season (season_leads, /admin/season) when it names a public house character;
 *    else the most reviewed of last season's house survivors (`houseRanked`, best first).
 *  - The suitors, up to `places - 1`: the approved auditions by votes (lib/auditions.ts shortlist) first; then, when
 *    fewer than `suitorsMin` qualify, the house's own agent-made characters (made over MCP by our own agents, never an
 *    outside agent's) with the most public dates, until the places are full. The lead is never a suitor.
 */
async function pickLeadCast(db: Db, season: string, rule: { places: number; suitorsMin: number }, houseRanked: string[]): Promise<CastSlot[]> {
  const lead = (await leadOverride(db, season)) ?? houseRanked[0] ?? dealt(season, 1)[0];
  const { shortlist } = await import("./auditions");
  const suitorPlaces = Math.max(rule.suitorsMin, rule.places - 1);
  const fans = (await shortlist(db, season)).filter((id) => id !== lead).slice(0, suitorPlaces);
  let suitors = fans;
  if (suitors.length < suitorPlaces) suitors = [...suitors, ...(await houseSuitorFill(db, [lead, ...suitors], suitorPlaces - suitors.length))];
  return [{ character_id: lead, slot: 0, source: "lead" as const }, ...suitors.map((character_id, i) => ({ character_id, slot: i + 1, source: "suitor" as const }))];
}

/**
 * The house's own suitors, for the places approved auditions leave open: the house's agent-made characters (ours, public,
 * open to dates) with the most aired public dates, `n` of them, never one of `taken`. The Sunday premiere's pilot
 * (lib/sunday-premiere.ts) takes the first when the shortlist is empty, so the pilot's suitor is the cast's first fill.
 */
export async function houseSuitorFill(db: Db, taken: readonly string[], n: number): Promise<string[]> {
  if (n <= 0) return [];
  const { loadOurIds } = await import("./our-traffic");
  const ours = await loadOurIds(db).catch(() => [] as string[]);
  const { rows } = await db.query<{ id: string }>(
    `select c.id from characters c
      where c.created_via = 'mcp' and not c.is_house and c.owner_id = any($1::text[]) and c.owner_id <> 'deleted'
        and c.visibility = 'public' and c.open_to_dates and c.id <> all($2::text[])
      order by (select count(*) from episodes e
                 where (e.character_a = c.id or e.character_b = c.id) and e.status = 'ready' and e.visibility = 'public' and e.revealed_at is not null) desc,
               c.created_at, c.id
      limit $3`,
    [ours, [...taken], n],
  );
  return rows.map((r) => r.id);
}

/** The admin's pick of a season's lead (/admin/season), when it still names a public house character. */
export async function leadOverride(db: Db, season: string): Promise<string | null> {
  const { rows } = await db.query<{ character_id: string }>(
    `select l.character_id from season_leads l join characters c on c.id = l.character_id
      where l.season_id = $1 and c.is_house and c.premium_sku is null and c.visibility = 'public'`,
    [season],
  );
  return rows[0]?.character_id ?? null;
}

/** Sets (or, with null, clears) the admin's pick of a season's lead; it takes effect when that season picks its cast. */
export async function setLeadOverride(db: Db, season: string, characterId: string | null): Promise<void> {
  if (!characterId) {
    await db.query(`delete from season_leads where season_id = $1`, [season]);
    return;
  }
  await db.query(`insert into season_leads (season_id, character_id) values ($1, $2) on conflict (season_id) do update set character_id = excluded.character_id`, [season, characterId]);
}

/**
 * A Botchelor season's lead and the suitors still in, from the loaded cast (sync, like seasonCastIds): the lead is the
 * house side, the suitors are the fan side still on (a suitor sent home leaves the cast like a withdrawal). Null when
 * the loaded cast has no lead (every other format), so callers fall through to the classic pairing.
 */
export function leadAndSuitors(now: Date = new Date()): { lead: string; suitors: string[] } | null {
  if (override) return leadForTests ? { lead: leadForTests, suitors: fanOverride ?? [] } : null;
  const season = seasonIdAt(now);
  if (stored?.season !== season || !stored.lead) return null;
  return { lead: stored.lead, suitors: stored.fans };
}

/**
 * The suitor whose turn it is on a Botchelor season's house dates: the season's days deal the suitors in order (day 1
 * the first, day 2 the next…), `offset` for a day's later rooms, so every suitor dates the lead before Sunday. Null
 * without a lead or with no suitor left. The week's challenge (lib/house-conflict.ts) can trade two days of it: the
 * winner takes the day after the challenge, and whoever's day that was takes the winner's next one. The same dates,
 * in another order: none is added, and nothing about how any of them ends changes.
 */
export function suitorInTurn(now: Date, offset = 0): [string, string] | null {
  const cast = leadAndSuitors(now);
  if (!cast || !cast.suitors.length) return null;
  const start = seasonWindow(now).start.getTime();
  const DAY = 24 * 60 * 60 * 1000;
  const day = Math.floor((now.getTime() - start) / DAY);
  const n = cast.suitors.length;
  const inTurn = (d: number, off = 0) => cast.suitors[(d + off) % n];
  // A challenge's prize (HousePrize 'lead_date'): two days of the rotation trade places, and only the day's first
  // date (offset 0). On the prize day the winner dates the lead; on the winner's own next day, whoever gave theirs up.
  if (offset === 0) {
    for (const p of housePrizes(now)) {
      if (p.kind !== "lead_date" || !cast.suitors.includes(p.winner)) continue;
      const prizeDay = Math.floor((Date.parse(`${p.day}T12:00:00.000Z`) - start) / DAY);
      const displaced = inTurn(prizeDay);
      if (displaced === p.winner || day < prizeDay || day > prizeDay + n) continue;
      if (day === prizeDay) return [cast.lead, p.winner];
      let own = prizeDay + 1;
      while (inTurn(own) !== p.winner) own++;
      if (day === own) return [cast.lead, displaced];
    }
  }
  return [cast.lead, inTurn(day, offset)];
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
  const { tellCastOwners } = await import("./auditions");
  await tellCastOwners(db, season, picks).catch(() => {});
  return picks;
}

/** Loads this season's stored cast into memory for seasonCastIds, at most once a minute; run from getDb. */
export async function refreshSeasonCast(db: Db, now: Date = new Date()): Promise<void> {
  const season = seasonIdOf(now);
  if (stored?.season === season && Date.now() - stored.at < FRESH_MS) return;
  await ensureSeasonCast(db, now);
  const { house, fans, lead } = await castKinds(db, season);
  // The season's challenge prizes (lib/house-conflict.ts): a failed read leaves the rotation as it always was.
  const prizes = await db
    .query<HousePrize>(`select day, winner_id as winner, with_id as "with", kind, title, scene_id as scene from house_prizes where season_id = $1 order by day`, [season])
    .then((r) => r.rows)
    .catch(() => [] as HousePrize[]);
  stored = { season, ids: house, fans, lead, prizes, at: Date.now() };
}

/** Forget the loaded cast, so the next getDb loads it again (a fan pick that left the cast leaves at once here). */
export function resetStoredSeasonCastForTests(): void {
  stored = null;
}
export const forgetLoadedSeasonCast = resetStoredSeasonCastForTests;

export type CastCard = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: readonly string[];
  archetype: string;
  hue: number;
  fan: boolean;
  /** Its generated portrait's path, when it has one (a house character's face is a file: lib/portraits.ts). */
  portrait: string | null;
};

/**
 * This season's cast as cards, from the database, so a generated newcomer (lib/season-gen.ts) shows too, and the
 * fan picks after the house (`fan`: a person's own character, lib/auditions.ts).
 */
export async function seasonCastCards(db: Db, now: Date = new Date()): Promise<CastCard[]> {
  const fans = seasonFanCastIds(now);
  const ids = [...seasonCastIds(now), ...fans];
  const { rows } = await db.query<{ id: string; name: string; age: number; bio: string; traits: string[]; hue: number | null; archetype: string | null; portrait: string | null }>(
    `select c.id, c.name, c.age, c.bio, c.traits, c.avatar_hue as hue, sc.archetype, ${portraitPathSql("c")} as portrait
       from characters c left join season_candidates sc on sc.character_id = c.id
      where c.id = any($1)`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const house = HOUSE_CHARACTERS.find((c) => c.id === id);
    const fan = fans.includes(id);
    // On a Botchelor season the cards bill who's who in the format: the lead, then the suitors (lib/ceremony.ts).
    const cast = leadAndSuitors(now);
    const role = cast ? (id === cast.lead ? "The lead" : "Suitor") : null;
    return [{ id, name: r.name, age: r.age, bio: r.bio, traits: r.traits, archetype: role ?? house?.archetype ?? r.archetype ?? (fan ? "Fan pick" : "The newcomer"), hue: r.hue ?? house?.hue ?? 200, fan, portrait: r.portrait }];
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

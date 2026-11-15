/**
 * The house books its own couples' overnight dates (lib/overnight.ts; the hourly lobby job calls this). A pair of two
 * house characters on this season's cast that has earned one (the milestone, from their aired dates) gets an overnight
 * date as a house room, like every date between two house characters (lib/watch.ts createTemplateParty): show-paid, on
 * the show's model, at the pair's evening place, at most OVERNIGHT_RULES.housePerDay a UTC day show-wide. The house
 * says yes for both: nobody owns either. The engine decides it like any date; the mark only changes how the ending is
 * told once it airs.
 *
 * Apart from lib/overnight.ts because lib/watch.ts airs dates through lib/relationship-events.ts, which reads
 * lib/overnight.ts: a booker in that file would close the circle.
 */
import { track } from "./analytics";
import { generationPaused } from "./compute";
import type { Db } from "./db";
import { loadOvernight, markOvernight, OVERNIGHT_KEY } from "./overnight";
import { OVERNIGHT_RULES, overnightDatesOn } from "./overnight-shared";
import { showCastIds } from "./season-cast";
import { createTemplateParty, SYSTEM_CREATOR_ID } from "./watch";

/** How many of the house's warmest couples one pass looks at (each is three small reads). */
const LOOKED_AT = 12;

export type HouseOvernightRun = {
  /** The room the overnight date premieres in, when one was booked. */
  room: string | null;
  episode_id: string | null;
  /** Why nothing was booked. */
  reason?: "off" | "paused" | "daily_limit" | "nobody_due" | "not_made";
};

/** House-booked overnight dates since UTC midnight. */
async function bookedToday(db: Db, now: Date): Promise<number> {
  const day = `${now.toISOString().slice(0, 10)}T00:00:00Z`;
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from episodes where creator_id = $1 and setup->>'${OVERNIGHT_KEY}' = 'true' and created_at >= $2::timestamptz`,
    [SYSTEM_CREATOR_ID, day],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Books at most one overnight date for a house couple that has earned it: the couple whose latest aired date is the
 * newest goes first. Nothing while generation is paused, with the switch off, or once today's is booked.
 */
export async function bookHouseOvernight(db: Db, now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<HouseOvernightRun> {
  const nothing = (reason: HouseOvernightRun["reason"]): HouseOvernightRun => ({ room: null, episode_id: null, reason });
  if (!overnightDatesOn(env)) return nothing("off");
  if (generationPaused(env)) return nothing("paused");
  if ((await bookedToday(db, now)) >= OVERNIGHT_RULES.housePerDay) return nothing("daily_limit");
  const cast = showCastIds(now);
  // The public record's own columns narrow it to couples that could qualify; loadOvernight then checks the whole rule.
  const { rows } = await db.query<{ lo: string; hi: string }>(
    `select r.character_a as lo, r.character_b as hi
       from relationships r
       join characters a on a.id = r.character_a
       join characters b on b.id = r.character_b
      where a.is_house and b.is_house and a.premium_sku is null and b.premium_sku is null
        and r.character_a = any($1) and r.character_b = any($1)
        and r.public_dates >= $2 and r.public_last_ending = 'second_date'
      order by r.public_last_at desc nulls last, r.character_a, r.character_b
      limit $3`,
    [cast, OVERNIGHT_RULES.minAiredDates, LOOKED_AT],
  );
  for (const r of rows) {
    const pair = await loadOvernight(db, r.lo, r.hi, now).catch(() => null);
    if (!pair?.milestone.ok) continue;
    const made = await createTemplateParty(db, r.lo, r.hi, { venuePool: [pair.venue] });
    if (!made || !made.ok) return nothing("not_made");
    const episodeId = (await db.query<{ episode_id: string }>(`select episode_id from watch_parties where id = $1`, [made.id])).rows[0]?.episode_id ?? null;
    if (!episodeId) return nothing("not_made");
    await markOvernight(db, episodeId);
    track("overnight_booked", { episode_id: episodeId, by: "house" });
    return { room: made.id, episode_id: episodeId };
  }
  return nothing("nobody_due");
}

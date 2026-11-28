/**
 * The casting sway (docs/seasons.md "The producer", "The casting sway"; Dave's call, 2026-11-28: "for better
 * television"). The producer sways WHO goes on the house's own dates and WHERE they happen, never how they end.
 *
 * Why: in local simulations the house-cast dates ended in disaster 8 times out of 11, so a prediction player could
 * always pick "disaster" and win. Varied endings are better television and keep the prediction game honest.
 *
 * How, and the rules it keeps:
 *  - It only re-ranks candidates the show was already free to choose. Today that is the lobby's plainly dealt pair
 *    (lib/watch.ts lobbyDeal, after the lead's suitor in turn, a challenge winner's pick, a staged arc step, an
 *    introduction): the dealt pair is candidate 0 and SWAY_CANDIDATES - 1 more are dealt the same way from the day.
 *    A pair a person, an agent, a vote or the format named is never a candidate list, so it is never changed.
 *  - The pair: each candidate's date is built under the ONE episode id the real date will be stored under, and the
 *    engine's own decision is read for it (lib/watch.ts previewTemplateDate: buildDate + decideTraced, the same input
 *    and seed the real date uses, minus the hot takes, which the engine never reads). So the preview IS the ending the
 *    date will have; nothing is shopped across seeds, and the engine decides the chosen date exactly as any other.
 *  - It acts only when the recent house endings run lopsided (`lopsidedEnding`: the last two the same, or one ending
 *    holding two thirds of the last SWAY_RECENT). Then a candidate whose previewed ending is a different one wins, and
 *    among those the closest call (the engine's margin nearest one of its marks); ties keep the dealt order. With a
 *    varied recent mix, or no history, the dealt pair stands exactly as before.
 *  - The venue: the engine never reads a venue, so no preview can say anything about one. A documented heuristic
 *    instead: a venue the show deals itself skips the backdrops of the last SWAY_AVOID_VENUES house disasters (passed
 *    as extra venues to deal past, the way a character's last two venues are). A venue named by a booker, an agreed
 *    plan, a vote's twist or a one-venue pool is never changed.
 *  - Seeded and cheap: rows and the deterministic engine, no model call. PRODUCER_SWAY=0 turns it off.
 */
import type { Db } from "./db";
import { marks, type Outcome } from "./engine";
import type { Ending } from "./rules";
import type { PlaceId } from "./venues";

type Env = Record<string, string | undefined>;

/** PRODUCER_SWAY: on unless it is "0". Off: every house date is dealt exactly as before. */
export const producerSwayOn = (env: Env = process.env): boolean => env.PRODUCER_SWAY?.trim() !== "0";

/** How many of the house's latest dates the sway reads. */
export const SWAY_RECENT = 6;
/** How many pairs the lobby's plain deal offers the sway (the dealt pair is the first). */
export const SWAY_CANDIDATES = 4;
/** How many recent house disasters' venues a show-dealt venue skips. */
export const SWAY_AVOID_VENUES = 2;

export type RecentHouseDate = { ending: Ending; venue: string | null };

/** The house's own latest dates (template rooms), newest first, made before `before`. Server-side only: endings stay here. */
export async function recentHouseDates(db: Db, before: Date = new Date(), limit: number = SWAY_RECENT): Promise<RecentHouseDate[]> {
  const { rows } = await db.query<RecentHouseDate>(
    `select e.ending, e.setup->>'venue' as venue
       from watch_parties w join episodes e on e.id = w.episode_id
      where w.kind = 'template' and e.created_at < $1
      order by e.created_at desc
      limit $2`,
    [before.toISOString(), limit],
  );
  return rows;
}

/** The ending the recent mix leans on, or null when it's varied: the latest two alike, or one ending in two thirds. */
export function lopsidedEnding(recent: readonly Ending[]): Ending | null {
  if (recent.length >= 2 && recent[0] === recent[1]) return recent[0];
  if (recent.length < 3) return null;
  const counts = new Map<Ending, number>();
  for (const e of recent) counts.set(e, (counts.get(e) ?? 0) + 1);
  for (const [e, n] of counts) if (n * 3 >= recent.length * 2) return e;
  return null;
}

/** How far the engine's margin sat from its nearest mark (smaller: a closer call). Infinity without a margin. */
export function closeness(outcome: Pick<Outcome, "margin">, version: number | null | undefined): number {
  if (typeof outcome.margin !== "number") return Number.POSITIVE_INFINITY;
  const { friendsAt, secondDateAt } = marks(version);
  return Math.min(Math.abs(outcome.margin - friendsAt), Math.abs(outcome.margin - secondDateAt));
}

export type Previewed = { ending: Ending; margin?: number; version?: number | null };

/**
 * Which candidate the sway picks (an index into `previewed`, in dealt order). With a varied mix, 0: the dealt one.
 * Otherwise one whose previewed ending isn't the one the mix leans on, the closest call first, ties in dealt order; when
 * every candidate previews the same ending, the closest call of them. Pure.
 */
export function swayPick(previewed: readonly Previewed[], recent: readonly Ending[]): number {
  const hot = lopsidedEnding(recent);
  if (!hot || previewed.length < 2) return 0;
  let best = 0;
  const key = (p: Previewed) => [p.ending === hot ? 1 : 0, closeness(p, p.version)] as const;
  for (let i = 1; i < previewed.length; i++) {
    const [ha, ca] = key(previewed[i]);
    const [hb, cb] = key(previewed[best]);
    if (ha < hb || (ha === hb && ca < cb)) best = i;
  }
  return best;
}

/** The venues of the latest house disasters, for a show-dealt venue to skip (the venue heuristic). */
export function disasterVenues(recent: readonly RecentHouseDate[], n: number = SWAY_AVOID_VENUES): PlaceId[] {
  const out: PlaceId[] = [];
  for (const r of recent) {
    if (out.length >= n) break;
    if (r.ending === "disaster" && r.venue && !out.includes(r.venue as PlaceId)) out.push(r.venue as PlaceId);
  }
  return out;
}

/** The venues a show-dealt house date on `day` skips: the latest house disasters made before that day began. Never throws. */
export async function swayAvoidVenues(db: Db, day: string, env: Env = process.env): Promise<PlaceId[]> {
  if (!producerSwayOn(env)) return [];
  const recent = await recentHouseDates(db, new Date(`${day}T00:00:00Z`)).catch(() => []);
  return disasterVenues(recent);
}

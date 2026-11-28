/**
 * The theater's crowd (2026-11-28, Dave's "do 1-6", item 4): a viewer taps 😍 😬 💀 on the line on screen and it floats
 * over the stage; everyone who replays the date later sees the crowd's taps come back on the same lines, with a tag
 * like "12 viewers 😬 here" once enough of them did.
 *
 * Counts only, and only real ones: no person is stored with a tap (so nothing here is anyone's data to export or
 * delete), the bots' remarks (lib/peanut-gallery.ts) never add to them, and the route limits taps per connection and
 * per session. The client sends at most one of each kind per line per browser.
 */
import type { Db } from "./db";

export const REACTION_KINDS = ["swoon", "cringe", "dead"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** What each looks like and how the tag says it: "12 viewers swooned here". */
export const REACTIONS: Record<ReactionKind, { emoji: string; verb: string; label: string }> = {
  swoon: { emoji: "😍", verb: "swooned", label: "Swoon" },
  cringe: { emoji: "😬", verb: "cringed", label: "Cringe" },
  dead: { emoji: "💀", verb: "died", label: "Dead" },
};

export type LineTallies = Record<number, Partial<Record<ReactionKind, number>>>;

/** Taps per connection and per session: a long date is ~40 lines, three kinds each, with room to watch it twice. */
export const LINE_REACTION_LIMITS = { perHour: 240, perDay: 1200 };

/** A line's tag shows once this many viewers tapped the same thing on it. */
export const TAG_AT = 3;

export async function lineTallies(db: Db, episodeId: string): Promise<LineTallies> {
  const { rows } = await db.query<{ line_index: number; kind: ReactionKind; count: number }>(
    `select line_index, kind, count from line_reactions where episode_id = $1 and count > 0 order by line_index`,
    [episodeId],
  );
  const out: LineTallies = {};
  for (const r of rows) (out[Number(r.line_index)] ??= {})[r.kind] = Number(r.count);
  return out;
}

export async function addReaction(db: Db, episodeId: string, lineIndex: number, kind: ReactionKind): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `insert into line_reactions (episode_id, line_index, kind, count) values ($1, $2, $3, 1)
     on conflict (episode_id, line_index, kind) do update set count = line_reactions.count + 1, updated_at = now()
     returning count`,
    [episodeId, lineIndex, kind],
  );
  return Number(rows[0]?.count ?? 0);
}

/** The tag for one line, or null: its most tapped kind, once at least TAG_AT viewers did it. */
export function lineTag(tally: Partial<Record<ReactionKind, number>> | undefined): { kind: ReactionKind; count: number; text: string } | null {
  if (!tally) return null;
  let best: ReactionKind | null = null;
  for (const k of REACTION_KINDS) if ((tally[k] ?? 0) > (best ? (tally[best] ?? 0) : 0)) best = k;
  if (!best) return null;
  const count = tally[best] ?? 0;
  if (count < TAG_AT) return null;
  return { kind: best, count, text: `${count} viewers ${REACTIONS[best].verb} here` };
}

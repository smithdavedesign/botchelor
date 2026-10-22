/**
 * The moments in a relationship worth telling people about (lib/notifications.ts). Kept apart from the graph
 * itself (lib/relationships.ts), which stays a pure, derived record.
 */
import { shortName } from "./names";
import type { Db } from "./db";
import { settleCommitment, warnWhenSparksOut } from "./partners";
import { resolveArcs } from "./arcs";
import { followerIds } from "./follows";
import { notifyAll, ownersOf } from "./notifications";
import { pairKey, refreshRelationship, STAGE_LABELS, type Stage } from "./relationships";
import { ENDING_LABELS } from "./rules";

/** How far along a romance a stage is; friends, exes and bad blood aren't a step up. */
const RANK: Partial<Record<Stage, number>> = { just_met: 1, sparks: 2, dating: 3, going_steady: 4 };

/**
 * Refreshes a pair's edge after one of their dates airs, then tells people about it:
 *  - a move up a stage ("Mira & Rafe: 💞 Dating") to the characters' owners and the couple's followers;
 *  - otherwise, a new public date to its followers ("Mira & Rafe went on another date");
 * and settles the arc predictions the new public record decides (lib/arcs.ts). Only on airing, so making a date
 * private and public again can't re-announce anything.
 */
export async function refreshAndAnnounce(db: Db, x: string, y: string, opts: { episodeId?: string } = {}): Promise<void> {
  const [lo, hi] = pairKey(x, y);
  const prior = (await db.query<{ public_stage: Stage | null; stage: Stage | null }>(`select public_stage, stage from relationships where character_a = $1 and character_b = $2`, [lo, hi])).rows[0];
  const before = prior?.public_stage ?? null;
  const rel = await refreshRelationship(db, lo, hi);
  const after = rel?.public.stage ?? null;
  const names = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[lo, hi]])).rows.map((r) => [r.id, shortName(r.name)]),
  );
  const couple = `${names.get(lo)} & ${names.get(hi)}`;
  const [owners, followers] = await Promise.all([ownersOf(db, [lo, hi]), followerIds(db, lo, hi)]);
  const steppedUp = after !== null && (RANK[after] ?? 0) >= 2 && (RANK[after] ?? 0) > (RANK[before ?? "bad_blood"] ?? 0);
  if (steppedUp) {
    await notifyAll(db, [owners.get(lo), owners.get(hi), ...followers], {
      kind: "stage_up",
      title: `${couple}: ${STAGE_LABELS[after!]}`,
      body: after === "sparks" ? "Their first date ended in a second date." : after === "dating" ? "Two second dates in a row: they're dating." : "They've become a fixture.",
      link: `/couples/${lo}/${hi}`,
    });
  } else if (opts.episodeId && followers.length) {
    // A followed couple's new date, when it's in the public record (aired, public, not hidden).
    const aired = rel?.history.find((h) => h.episode_id === opts.episodeId && h.public);
    if (aired) {
      await notifyAll(db, followers, {
        kind: "couple_date",
        title: `${couple} went on another date`,
        body: `It ended: ${ENDING_LABELS[aired.ending]}.`,
        link: `/episodes/${opts.episodeId}`,
      });
    }
  }
  await resolveArcs(db, lo, hi).catch(() => 0);
  // In a relationship now? Each side settles one partner or more, and a one-partner side closes to dates.
  await settleCommitment(db, lo, hi).catch(() => {});
  // 2.4.2: Sparks (the stage that counts every date, as settleCommitment's does)? One more second date makes them a Dating
  // couple, so a one-partner side's owner hears it first, with the opt-out. 2.9.0: when the date that made them Sparks airs,
  // once (lib/partners.ts warnWhenSparksOut; 2.7.0 sent it when that date was written, ahead of its airing).
  await warnWhenSparksOut(db, lo, hi, rel).catch(() => 0);
}

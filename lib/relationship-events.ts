/**
 * The moments in a relationship worth telling people about (lib/notifications.ts). Kept apart from the graph
 * itself (lib/relationships.ts), which stays a pure, derived record.
 */
import type { Db } from "./db";
import { notifyAll, ownersOf } from "./notifications";
import { pairKey, refreshRelationship, STAGE_LABELS, type Stage } from "./relationships";

/** How far along a romance a stage is; friends, exes and bad blood aren't a step up. */
const RANK: Partial<Record<Stage, number>> = { just_met: 1, sparks: 2, dating: 3, going_steady: 4 };

/** Everyone who should hear about a couple: the characters' owners, plus whoever else the caller adds (followers). */
export type Audience = (lo: string, hi: string) => Promise<string[]>;

/**
 * Refreshes a pair's edge after one of their dates airs, and announces it when the public record moved up a stage
 * ("Mira & Rafe are now 💞 Dating"). Only on airing, so making a date private and public again can't re-announce.
 */
export async function refreshAndAnnounce(db: Db, x: string, y: string, followers?: Audience): Promise<void> {
  const [lo, hi] = pairKey(x, y);
  const before = (await db.query<{ public_stage: Stage | null }>(`select public_stage from relationships where character_a = $1 and character_b = $2`, [lo, hi])).rows[0]?.public_stage ?? null;
  const rel = await refreshRelationship(db, lo, hi);
  const after = rel?.public.stage ?? null;
  if (!after || (RANK[after] ?? 0) < 2 || (RANK[after] ?? 0) <= (RANK[before ?? "bad_blood"] ?? 0)) return;
  const names = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[lo, hi]])).rows.map((r) => [r.id, r.name.split(" ")[0]]),
  );
  const owners = await ownersOf(db, [lo, hi]);
  await notifyAll(db, [owners.get(lo), owners.get(hi), ...(followers ? await followers(lo, hi) : [])], {
    kind: "stage_up",
    title: `${names.get(lo)} & ${names.get(hi)}: ${STAGE_LABELS[after]}`,
    body: after === "sparks" ? "Their first date ended in a second date." : after === "dating" ? "Two second dates in a row: they're dating." : "They've become a fixture.",
    link: `/couples/${lo}/${hi}`,
  });
}

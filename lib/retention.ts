/**
 * How long the data plan's kept data stays (docs/data-plan.md; the privacy page's "How long we keep it"). The daily job
 * runs pruneKeptData first, before anything slow, so a run that hits its time limit later never skips it.
 *
 * 400 days everywhere: 13 months keeps a year-over-year view, as the deck impressions (lib/swipes.ts) and the MCP call
 * log already did. The one exception is a consent decision in the choice history: it's the record of what someone
 * agreed to and when, so it stays as long as the account does (deleting the account removes it).
 *
 * What isn't here lives as long as the thing it belongs to: an episode's engine_trace and turn_meta go with the episode,
 * line votes with the voter's account, a consent with its account. A delete or forget removes the rest earlier
 * (lib/account.ts).
 */
import { track } from "./analytics";
import type { Db } from "./db";

/** Days each kind of kept data stays. */
export const RETENTION_DAYS = {
  choice_history: 400,
  swipe_impressions: 400,
  turn_drafts: 400,
  relationship_events: 400,
  episode_variations: 400,
  language_seen: 400,
} as const;
export type PrunedTable = keyof typeof RETENTION_DAYS;

/** Each table's prune; $1 is the cutoff. Every one reads an index on its time column (lib/db.ts). */
const PRUNE_SQL: Record<PrunedTable, string> = {
  // A consent decision stays while the account does (see above).
  choice_history: `delete from choice_history where at < $1 and kind <> 'ml_consent'`,
  swipe_impressions: `delete from swipe_impressions where at < $1`,
  turn_drafts: `delete from turn_drafts where created_at < $1`,
  relationship_events: `delete from relationship_events where at < $1`,
  episode_variations: `delete from episode_variations where created_at < $1`,
  language_seen: `delete from language_seen where day < $1::date`,
};

/** Deletes what's past its time, table by table (one failing never stops the rest). Returns how many rows each lost. */
export async function pruneKeptData(db: Db, now: Date = new Date()): Promise<Record<PrunedTable, number>> {
  const pruned = {} as Record<PrunedTable, number>;
  for (const table of Object.keys(RETENTION_DAYS) as PrunedTable[]) {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS[table] * 86_400_000).toISOString();
    pruned[table] = await db
      .query<{ n: number }>(`with gone as (${PRUNE_SQL[table]} returning 1) select count(*)::int as n from gone`, [cutoff])
      .then((r) => Number(r.rows[0]?.n ?? 0))
      .catch(() => 0);
  }
  track("data_pruned", pruned);
  return pruned;
}

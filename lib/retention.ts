/**
 * How long the data plan's kept data stays (docs/data-plan.md; the privacy page's "How long we keep it"). The daily job
 * runs pruneKeptData first, before anything slow, so a run that hits its time limit later never skips it.
 *
 * 400 days everywhere: 13 months keeps a year-over-year view, as the deck impressions (lib/swipes.ts) and the MCP call
 * log already did. The house crowd's own impressions and calls are the exception the other way (pruneHouseBotLogs). The one exception is a consent decision in the choice history: it's the record of what someone
 * agreed to and when, so it stays as long as the account does (deleting the account removes it).
 *
 * What isn't here lives as long as the thing it belongs to: an episode's engine_trace and turn_meta go with the episode,
 * line votes with the voter's account, a consent with its account. A delete or forget removes the rest earlier
 * (lib/account.ts).
 */
import { track } from "./analytics";
import type { Db } from "./db";
import { HOUSE_BOT_CLIENT_PREFIX, isHouseBotSql } from "./house-bots";

/** Days each kind of kept data stays. */
export const RETENTION_DAYS = {
  choice_history: 400,
  swipe_impressions: 400,
  turn_drafts: 400,
  relationship_events: 400,
  episode_variations: 400,
  language_seen: 400,
  web_events: 400,
  plus_interest: 400,
} as const;
export type PrunedTable = keyof typeof RETENTION_DAYS;

/** Each table's prune; $1 is the cutoff. Every one reads an index on its time column (lib/db.ts). */
const PRUNE_SQL: Record<PrunedTable, string> = {
  // A consent decision stays while the account does (see above).
  choice_history: `delete from choice_history where at < $1 and kind <> 'ml_consent'`,
  swipe_impressions: `delete from swipe_impressions where at < $1`,
  turn_drafts: `delete from turn_drafts where created_at < $1`,
  // A finale's engagement or wedding is where the couple stands, not a log line (lib/relationship-stages.ts reads it):
  // it stays while the two characters do.
  relationship_events: `delete from relationship_events where at < $1 and (kind is null or kind not in ('engaged', 'married'))`,
  episode_variations: `delete from episode_variations where created_at < $1`,
  language_seen: `delete from language_seen where day < $1::date`,
  web_events: `delete from web_events where at < $1`,
  // A tap on the Plus tile (lib/plus-interest.ts) is a signal for a decision; a year on, it's noise.
  plus_interest: `delete from plus_interest where created_at < $1`,
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

/**
 * The house crowd's own logs (David, 2026-11-19, scaling for the catalog cast): its bots (lib/house-bots.ts) are the
 * show's scripts, not people, and log about 23,000 deck impressions and 29,000 MCP calls a day between them. At 400
 * days that's about 20 million rows of our own scripts' traffic. Theirs stay HOUSE_BOT_LOG_DAYS; everyone else's 400.
 */
export const HOUSE_BOT_LOG_DAYS = 14;

/** Prunes the house crowd's deck impressions and MCP calls past HOUSE_BOT_LOG_DAYS. Returns how many rows each lost. */
export async function pruneHouseBotLogs(db: Db, now: Date = new Date()): Promise<{ swipe_impressions: number; mcp_calls: number }> {
  const cutoff = new Date(now.getTime() - HOUSE_BOT_LOG_DAYS * 86_400_000).toISOString();
  const count = (sql: string, params: unknown[]) =>
    db
      .query<{ n: number }>(`with gone as (${sql} returning 1) select count(*)::int as n from gone`, params)
      .then((r) => Number(r.rows[0]?.n ?? 0))
      .catch(() => 0);
  // The bots' characters first (a few hundred rows), then their impressions by the (viewer, at) index.
  const swipe_impressions = await count(
    `with bots as (select c.id from characters c where not c.is_house and c.owner_id is not null and ${isHouseBotSql("c.owner_id")})
     delete from swipe_impressions si using bots where si.viewer = bots.id and si.at < $1`,
    [cutoff],
  );
  const mcp_calls = await count(`delete from mcp_calls where created_at < $1 and client_name like $2`, [cutoff, `${HOUSE_BOT_CLIENT_PREFIX}%`]);
  const pruned = { swipe_impressions, mcp_calls };
  track("house_bot_logs_pruned", pruned);
  return pruned;
}

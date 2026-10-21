import type { Db } from "./db";

/**
 * House-run bots (#342, #417, #457, #489): agent-made characters that one of the show's own scripts plays (the loop's
 * swipe-back agent connects as "botchelor-loop-…"). They like back, text back and play their side of a date
 * automatically, so they're labelled house-run everywhere, never as another agent. The loop arena's background crowd
 * (scripts/loop/crowd.mjs) is house-run too, and says so: "botchelor-loop-crowd-<name>", one name per personality.
 */
export const HOUSE_BOT_CLIENT_PREFIX = "botchelor-loop-";

/** SQL: true when every MCP session of the agent in `agentSql` is a house-run bot's (null when it has none). */
export const houseBotSql = (agentSql: string): string =>
  `(select bool_and(coalesce(s.client_name, '') like '${HOUSE_BOT_CLIENT_PREFIX}%') from mcp_sessions s where s.agent_id = ${agentSql})`;

/** Whether an agent identity is one of the show's own scripts. */
export async function isHouseBotAgent(db: Db, agentId: string | null | undefined): Promise<boolean> {
  if (!agentId) return false;
  const { rows } = await db.query<{ bot: boolean | null }>(`select ${houseBotSql("$1")} as bot`, [agentId]);
  return rows[0]?.bot === true;
}

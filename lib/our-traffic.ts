/**
 * Our own traffic: client names and user agents of our checks, the loop's visitors and scripts. Its own module so
 * lib/mcp.ts can use it without importing lib/agent-analytics.ts, which imports lib/mcp.ts.
 * Extend it when a new check starts talking to production.
 */
import type { Db } from "./db";
import { HOUSE_BOT_CLIENT_PREFIX } from "./house-bots";
import { DELETED_OWNER } from "./rules";

export const OUR_TRAFFIC = /^(botchelor|live-|verify|curl|stats-check|smoke|agents-check|rounds-test|own-date-test|e2e)|\(Claude\)|botchelor-/i;
export const isOurs = (client: string | null, userAgent: string | null): boolean =>
  OUR_TRAFFIC.test(client ?? "") || OUR_TRAFFIC.test(userAgent ?? "");

/** The show's own always-on watch-party dates are booked by this id (lib/watch.ts SYSTEM_CREATOR_ID, repeated here so
 * the analytics don't import the watch module and everything it pulls in). */
export const SYSTEM_ID = "system";

/**
 * Every identity that's ours, for the analytics to leave out (Real use, lib/real-metrics.ts; the insights overview,
 * lib/insights.ts): admin accounts and any agent linked to one, every agent that ever connected as one of our checks or
 * as the loop's house-run bots and crowd, the deleted owner (a deleted account's kept characters) and the show itself.
 */
export async function loadOurIds(db: Db): Promise<string[]> {
  const ourClient = `(coalesce(client_name, '') ~* $1 or coalesce(user_agent, '') ~* $1 or coalesce(client_name, '') like $2)`;
  const { rows } = await db.query<{ id: string }>(
    `select user_id as id from admins
     union select l.agent_id from agent_links l join admins a on a.user_id = l.user_id
     union select agent_id from mcp_sessions where ${ourClient}
     union select agent_id from mcp_calls where agent_id is not null and ${ourClient}
     union select $3::text
     union select $4::text`,
    [OUR_TRAFFIC.source, `${HOUSE_BOT_CLIENT_PREFIX}%`, DELETED_OWNER, SYSTEM_ID],
  );
  return rows.map((r) => r.id);
}

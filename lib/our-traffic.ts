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
 * Characters our own scripts and tests make, by name: their owners are ours too. A harness run against production on
 * 2026-10-14 made eleven of the cast below from eleven fresh browsers in one minute, and the insights overview counted
 * them as new people (botchelor-41, 2026-10-22: "it isn't a drop; the week before was test traffic"). Sources:
 * scripts/harness.mjs CAST, scripts/sim-pairs.mjs and the tests' defaults, plus David's own test characters. Names nobody
 * picks by chance; extend it when a new script writes to production.
 */
export const OUR_TEST_NAMES: readonly string[] = [
  "Mira Quell", "Otto Fenn", "Tamsin Holloway", "Bas Niro", "Wrenna Sol", "Halden Voss", "Ysolde Marchetti", "Pike Alderman",
  "Soraya Bell", "Emrys Nakamura-Pine", "Emrys Pine", "Pernilla Krause", "Avi Marin", "Clem Osei", "Dez Kowal", "Hei Park",
  "Juno Wick", "Nova Pike", "Riv Marchand", "Current Partner", "David's OC",
  "David Smith", "Wren Kestrel",
];
/** A test-style character name ("Quinn Tester", "Planna Testwell"), in Postgres's word-boundary syntax. */
export const TEST_NAME_SQL = "\\m(test|tester|testwell|e2e)\\M";

/**
 * Every identity that's ours, for the analytics to leave out (Real use, lib/real-metrics.ts; the insights overview,
 * lib/insights.ts): admin accounts and any agent linked to one, every agent that ever connected as one of our checks or
 * as the loop's house-run bots and crowd, the owners of our scripts' and tests' characters (OUR_TEST_NAMES, test-style
 * names), the deleted owner (a deleted account's kept characters) and the show itself.
 */
export async function loadOurIds(db: Db): Promise<string[]> {
  const ourClient = `(coalesce(client_name, '') ~* $1 or coalesce(user_agent, '') ~* $1 or coalesce(client_name, '') like $2)`;
  const { rows } = await db.query<{ id: string }>(
    `select user_id as id from admins
     union select l.agent_id from agent_links l join admins a on a.user_id = l.user_id
     union select agent_id from mcp_sessions where ${ourClient}
     union select agent_id from mcp_calls where agent_id is not null and ${ourClient}
     union select owner_id from characters where owner_id is not null and (name = any($5::text[]) or name ~* $6)
     union select $3::text
     union select $4::text`,
    [OUR_TRAFFIC.source, `${HOUSE_BOT_CLIENT_PREFIX}%`, DELETED_OWNER, SYSTEM_ID, OUR_TEST_NAMES, TEST_NAME_SQL],
  );
  return rows.map((r) => r.id);
}

/**
 * Our own traffic: client names and user agents of our checks, the loop's visitors and scripts. Its own module so
 * lib/mcp.ts can use it without importing lib/agent-analytics.ts, which imports lib/mcp.ts.
 * Extend it when a new check starts talking to production.
 */
export const OUR_TRAFFIC = /^(botchelor|live-|verify|curl|stats-check|smoke|agents-check|rounds-test|own-date-test|e2e)|\(Claude\)|botchelor-/i;
export const isOurs = (client: string | null, userAgent: string | null): boolean =>
  OUR_TRAFFIC.test(client ?? "") || OUR_TRAFFIC.test(userAgent ?? "");

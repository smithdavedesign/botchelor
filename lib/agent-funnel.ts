/**
 * Agent funnel + marketing analytics.
 *
 * The web funnel (visit → activate → checkout) lives in `app/funnel.ts` and `app/conversion.ts`, and the
 * system-log event stream (`episode_generated`, `agent_tool_call`, …) lives in `lib/analytics.ts`. This file
 * adds the four-step AGENT funnel the admin page can roll up, the north-star cross-species-match event, and a
 * referrer bucket used by the web beacon.
 *
 * Events are stored in `analytics_events` (lib/db.ts). First-of-kind events use a partial unique index so a
 * tool that re-fires on retry never inflates the count.
 */

import type { Db } from "./db";

/** The events we care about, each tagged so the admin page can roll them up. */
export type AgentFunnelEvent =
  /** First time a session (an mcp_sessions.id) completes initialize. */
  | "agent_initialize"
  /** First time an agent_id creates a character. */
  | "agent_first_character"
  /** First time an agent_id's character finishes a date (any kind). */
  | "agent_first_date"
  /** An agent_id's return 6–8 days after its first date. */
  | "agent_day_7_return"
  /** An episode where the two creators are a human and a stranger agent (not the same user). */
  | "cross_species_match"
  /** The agent-operator pass sold. */
  | "pass_purchased";

export type MarketingReferrer =
  | "google"
  | "bluesky"
  | "discord"
  | "reddit"
  | "twitter"
  | "mcp_registry"
  | "direct"
  | "other";

/**
 * Record an agent event idempotently per (user_id, event). A second `agent_first_character` for the same
 * agent is a no-op (the funnel count stays truthful).
 */
export async function recordAgentEvent(
  db: Db,
  agentId: string | null,
  event: AgentFunnelEvent,
  props: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  if (!agentId) return;
  try {
    await db.query(
      `insert into analytics_events (user_id, event, props)
       values ($1, $2, $3::jsonb)
       on conflict (user_id, event) where event in (
         'agent_initialize', 'agent_first_character', 'agent_first_date', 'agent_day_7_return'
       ) do nothing`,
      [agentId, event, JSON.stringify(props)],
    );
  } catch {
    // Analytics never breaks a tool call.
  }
}

/** The agent funnel, counted on the current database. Returns absolute counts and the step ratios. */
export async function agentFunnel(db: Db): Promise<{
  initialize: number;
  first_character: number;
  first_date: number;
  day_7_return: number;
  cross_species: number;
  convert_character: number;
  convert_date: number;
  retain_day_7: number;
}> {
  try {
    const { rows } = await db.query<{ event: string; n: number }>(
      `select event, count(distinct user_id)::int as n from analytics_events
         where event in ('agent_initialize','agent_first_character','agent_first_date','agent_day_7_return','cross_species_match')
         group by event`,
    );
    const by: Record<string, number> = Object.fromEntries(rows.map((r) => [r.event, r.n]));
    const i = by.agent_initialize ?? 0;
    const c = by.agent_first_character ?? 0;
    const d = by.agent_first_date ?? 0;
    const r = by.agent_day_7_return ?? 0;
    const x = by.cross_species_match ?? 0;
    const rate = (n: number, over: number) => (over ? Math.round((n / over) * 1000) / 1000 : 0);
    return {
      initialize: i,
      first_character: c,
      first_date: d,
      day_7_return: r,
      cross_species: x,
      convert_character: rate(c, i),
      convert_date: rate(d, c),
      retain_day_7: rate(r, d),
    };
  } catch {
    return { initialize: 0, first_character: 0, first_date: 0, day_7_return: 0, cross_species: 0, convert_character: 0, convert_date: 0, retain_day_7: 0 };
  }
}

/** Bucket a referrer header into one of the fixed marketing channels. */
export function referrerBucket(
  referer: string | null | undefined,
  utm_source?: string | null,
): MarketingReferrer {
  const src = (utm_source ?? "").toLowerCase();
  if (src === "google" || src === "bluesky" || src === "discord" || src === "reddit" || src === "twitter" || src === "mcp_registry") return src;
  if (!referer) return "direct";
  try {
    const host = new URL(referer).hostname.toLowerCase();
    if (host.endsWith("google.com") || host.endsWith("bing.com") || host.endsWith("duckduckgo.com")) return "google";
    if (host.endsWith("bsky.app") || host.endsWith("bsky.social")) return "bluesky";
    if (host.endsWith("discord.com") || host.endsWith("discord.gg")) return "discord";
    if (host.endsWith("reddit.com") || host.endsWith("redd.it")) return "reddit";
    if (host.endsWith("x.com") || host.endsWith("twitter.com") || host.endsWith("t.co")) return "twitter";
    if (host.includes("modelcontextprotocol") || host.includes("smithery.ai") || host.includes("pulsemcp") || host.includes("glama.ai") || host === "mcp.so") return "mcp_registry";
    return "other";
  } catch {
    return "other";
  }
}

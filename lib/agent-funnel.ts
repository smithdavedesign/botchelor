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
  /** A pair (one web-made, one MCP-made character, two creators) that has had a date: see recordCrossSpecies. */
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

/**
 * The north-star cross-species event: a date between a character made on the website and one made over MCP, by two
 * different creators. Counted once per pair, whichever booking path made the date (web booking, go_on_date, a second
 * date, an agent's own date): the identity is `pair:<lo>:<hi>`, deduped by a partial unique index, and the props carry
 * no owner ids. "Species" is still where the character was made until characters carry a structured kind.
 */
export async function recordCrossSpecies(db: Db, episodeId: string, via: "booking" | "own_date"): Promise<void> {
  try {
    const ep = (
      await db.query<{ a: string; b: string; owner_a: string | null; via_a: string; owner_b: string | null; via_b: string }>(
        `select e.character_a as a, e.character_b as b, ca.owner_id as owner_a, ca.created_via as via_a, cb.owner_id as owner_b, cb.created_via as via_b
           from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
          where e.id = $1`,
        [episodeId],
      )
    ).rows[0];
    if (!ep || !ep.owner_a || !ep.owner_b || ep.owner_a === ep.owner_b) return;
    if ((ep.via_a === "mcp") === (ep.via_b === "mcp")) return;
    const [lo, hi] = ep.a < ep.b ? [ep.a, ep.b] : [ep.b, ep.a];
    await db.query(
      `insert into analytics_events (user_id, event, props) values ($1, 'cross_species_match', $2::jsonb)
       on conflict (user_id, event) where event = 'cross_species_match' and user_id like 'pair:%' do nothing`,
      [`pair:${lo}:${hi}`, JSON.stringify({ episode_id: episodeId, via })],
    );
  } catch {
    // Analytics never breaks a booking.
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
      // Cross-species counts pairs only (`pair:` rows): the pre-2026-10-22 rows keyed by episode id are left out.
      `select event, count(distinct user_id)::int as n from analytics_events
         where event in ('agent_initialize','agent_first_character','agent_first_date','agent_day_7_return')
            or (event = 'cross_species_match' and user_id like 'pair:%')
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

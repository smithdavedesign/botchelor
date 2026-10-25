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
import { loadOurIds } from "./our-traffic";

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
 * Mark agents that came back 6-8 days after their first date (the funnel's day-7 return). Run daily
 * (app/api/jobs/daily). An agent whose first date was 6-8 days ago and that has called a tool in the last 2 days has
 * returned; recordAgentEvent is idempotent (the partial unique index), so a repeat run never double-counts. Returns
 * how many were newly marked.
 */
export async function markDay7Returns(db: Db, now: Date = new Date()): Promise<number> {
  const lo = new Date(now.getTime() - 8 * 86_400_000).toISOString();
  const hi = new Date(now.getTime() - 6 * 86_400_000).toISOString();
  const recent = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const due = (
    await db.query<{ user_id: string }>(
      `select f.user_id from analytics_events f
        where f.event = 'agent_first_date' and f.created_at >= $1 and f.created_at < $2
          and exists (select 1 from mcp_calls m where m.agent_id = f.user_id and m.created_at >= $3)
          and not exists (select 1 from analytics_events d where d.user_id = f.user_id and d.event = 'agent_day_7_return')
        limit 500`,
      [lo, hi, recent],
    )
  ).rows;
  for (const row of due) await recordAgentEvent(db, row.user_id, "agent_day_7_return");
  return due.length;
}

/**
 * The cross-species booking log: a date booked between a character made on the website and one made over MCP, by two
 * different creators. Logged once per pair, whichever booking path made the date (web booking, go_on_date, a second
 * date, an agent's own date): the identity is `pair:<lo>:<hi>`, deduped by a partial unique index, and the props carry
 * no owner ids. "Species" is still where the character was made until characters carry a structured kind.
 *
 * It's logged at booking, before the date is written or anyone knows whether it airs, so it's a log of when a pair first
 * booked and how, not the north star: that's crossSpeciesPairs, counted from the finished dates themselves.
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

/**
 * The north star (docs/data-plan.md): how many real pairs have dated across the human × agent line. A pair counts once,
 * when at least one date between its two characters
 *  - finished (status ready: a date still being written, or one that failed and was given back, doesn't count),
 *  - isn't private (public and unlisted count: a private date is the creator's alone),
 *  - is between a character made on the website and one made over MCP, with two different owners, neither the show,
 *  - involves none of our own identities (lib/our-traffic.ts loadOurIds: admins, our checks and scripts, the house-run
 *    bots, people from before the public launch, the deleted owner),
 *  - and isn't a person's web character dating the character of an agent linked to that same person (agent_links).
 *
 * Derived from the dates at query time, never from the booking log: the log's old rows lost their owner ids on prod
 * (#666), and its pair rows include private and test pairs, so it can't be filtered after the fact. The dates can.
 */
export async function crossSpeciesPairs(db: Db): Promise<number> {
  const ours = await loadOurIds(db);
  const { rows } = await db.query<{ n: number }>(
    `select count(distinct least(e.character_a, e.character_b) || ':' || greatest(e.character_a, e.character_b))::int as n
       from episodes e
       join characters ca on ca.id = e.character_a
       join characters cb on cb.id = e.character_b
      where e.status = 'ready' and e.visibility <> 'private'
        and not ca.is_house and not cb.is_house
        and ca.owner_id is not null and cb.owner_id is not null and ca.owner_id <> cb.owner_id
        and (ca.created_via = 'mcp') <> (cb.created_via = 'mcp')
        and not (ca.owner_id = any($1::text[]) or cb.owner_id = any($1::text[]))
        and not exists (select 1 from agent_links al
                         where (al.agent_id = ca.owner_id and al.user_id = cb.owner_id)
                            or (al.agent_id = cb.owner_id and al.user_id = ca.owner_id))`,
    [ours],
  );
  return rows[0]?.n ?? 0;
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
         where event in ('agent_initialize','agent_first_character','agent_first_date','agent_day_7_return')
         group by event`,
    );
    const by: Record<string, number> = Object.fromEntries(rows.map((r) => [r.event, r.n]));
    const i = by.agent_initialize ?? 0;
    const c = by.agent_first_character ?? 0;
    const d = by.agent_first_date ?? 0;
    const r = by.agent_day_7_return ?? 0;
    // The north star, from the dates (crossSpeciesPairs), not from the cross_species_match log.
    const x = await crossSpeciesPairs(db);
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

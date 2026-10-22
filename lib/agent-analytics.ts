/**
 * Who comes in over MCP and what they do (David, 2026-10-17: "an admin analytics page to capture all these details").
 * Owner-only, on /admin/analytics. Built from two tables:
 *  - mcp_sessions: one row per connection since launch (client name and version, user agent, call count);
 *  - mcp_calls: every JSON-RPC call since 2026-10-18 (method or tool, whether it worked), from lib/mcp.ts logCall.
 *
 * Each connection is one of:
 *  - crawler: connected and listed (initialize, tools/list, resources, prompts) but called no tool. MCP directories,
 *    registries, uptime and security scanners.
 *  - explorer: called tools, but only ones that read.
 *  - player: a write worked (made a character, dated, texted, swiped, predicted, sent feedback…).
 * Our own traffic (live checks, e2e, curl from this Mac) is marked "ours" and kept out of the funnel and the totals
 * that matter, but shown, so nothing is hidden.
 */
import type { Db } from "./db";
import { MCP_TOOLS } from "./mcp";

import { isOurs, OUR_TRAFFIC } from "./our-traffic";
export { isOurs, OUR_TRAFFIC };

/** Tools that change something: their annotations say so (lib/mcp.ts READ vs WRITE). */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(
  MCP_TOOLS.filter((t) => (t.annotations as { readOnlyHint?: boolean } | undefined)?.readOnlyHint === false).map((t) => t.name),
);

export type Kind = "crawler" | "explorer" | "player";

export type ClientRow = {
  client: string;
  ours: boolean;
  sessions: number;
  crawler: number;
  explorer: number;
  player: number;
  tool_calls: number;
  tools: string[];
  characters: number;
  dates: number;
  feedback: number;
  last_seen: string;
  user_agent: string | null;
};

export type SessionRow = {
  id: string;
  agent_id: string;
  client: string;
  version: string | null;
  user_agent: string | null;
  ours: boolean;
  kind: Kind;
  calls: number;
  tools: string[];
  errors: number;
  characters: number;
  dates: number;
  feedback: number;
  first_seen: string;
  last_seen: string;
};

export type ToolRow = { tool: string; calls: number; agents: number; errors: number; last_error: string | null };
export type DayRow = { day: string; connections: number; crawlers: number; explorers: number; players: number; ours: number };

export type AgentAnalytics = {
  window_days: number;
  since: string;
  totals: { connections: number; clients: number; crawlers: number; explorers: number; players: number; ours: number };
  /** Outside agents only (not ours): how far they got. */
  funnel: { connected: number; listed_tools: number; called_a_tool: number; made_a_character: number; went_on_a_date: number; aired_a_date: number; sent_feedback: number };
  clients: ClientRow[];
  tools: ToolRow[];
  days: DayRow[];
  recent: SessionRow[];
  /** When per-call logging started: sessions before it only have a call count. */
  calls_logged_since: string | null;
};

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export async function agentAnalytics(db: Db, windowDays = 7, now = new Date()): Promise<AgentAnalytics> {
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const writes = [...WRITE_TOOLS];
  const { rows } = await db.query<{
    id: string; agent_id: string; client_name: string | null; client_version: string | null; user_agent: string | null; calls: number;
    created_at: Date | string; last_seen: Date | string; logged: number; tools: string[] | null; wrote: boolean; errors: number;
    listed: boolean; characters: number; dates: number; aired: number; feedback: number;
  }>(
    `with c as (
       select session_id,
              count(*)::int as logged,
              array_agg(tool order by created_at) filter (where tool is not null) as tools,
              bool_or(ok and tool = any($2)) as wrote,
              count(*) filter (where not ok)::int as errors,
              bool_or(method = 'tools/list') as listed
         from mcp_calls where created_at >= $1 group by session_id
     )
     select s.id, s.agent_id, s.client_name, s.client_version, s.user_agent, s.calls, s.created_at, s.last_seen,
            coalesce(c.logged, 0) as logged, c.tools, coalesce(c.wrote, false) as wrote, coalesce(c.errors, 0) as errors,
            coalesce(c.listed, false) as listed,
            (select count(*)::int from characters ch where ch.owner_id = s.agent_id and ch.created_via = 'mcp') as characters,
            (select count(*)::int from episodes e where (e.creator_id = s.agent_id or e.partner_performer = s.agent_id) and e.status = 'ready') as dates,
            (select count(*)::int from episodes e where e.creator_id = s.agent_id and e.revealed_at is not null) as aired,
            (select count(*)::int from agent_feedback f where f.agent_id = s.agent_id) as feedback
       from mcp_sessions s
       left join c on c.session_id = s.id
      where s.last_seen >= $1
      order by s.last_seen desc
      limit 5000`,
    [since.toISOString(), writes],
  );

  // With two facts only the funnel needs: did it list the tools, and how many dates did it air.
  type Seen = SessionRow & { listed: boolean; aired: number };
  const sessions: Seen[] = rows.map((r) => {
    const tools = r.tools ?? [];
    // Before per-call logging, a session only has a count: no calls is a crawler; owning something is a player.
    const kind: Kind = r.wrote || r.characters > 0 || r.feedback > 0 ? "player" : tools.length > 0 || (r.logged === 0 && r.calls > 0) ? "explorer" : "crawler";
    return {
      id: r.id, agent_id: r.agent_id, client: r.client_name ?? "unknown", version: r.client_version, user_agent: r.user_agent,
      ours: isOurs(r.client_name, r.user_agent), kind, calls: Math.max(r.calls, tools.length), tools, errors: r.errors,
      characters: r.characters, dates: r.dates, feedback: r.feedback, first_seen: iso(r.created_at)!, last_seen: iso(r.last_seen)!,
      listed: r.listed, aired: r.aired,
    };
  });

  const outside = sessions.filter((s) => !s.ours);
  const agentsWith = (pred: (s: (typeof outside)[number]) => boolean) => new Set(outside.filter(pred).map((s) => s.agent_id)).size;
  const funnel = {
    connected: outside.length,
    listed_tools: outside.filter((s) => s.listed || s.calls > 0).length,
    called_a_tool: outside.filter((s) => s.tools.length > 0 || s.kind !== "crawler").length,
    made_a_character: agentsWith((s) => s.characters > 0),
    went_on_a_date: agentsWith((s) => s.dates > 0),
    aired_a_date: agentsWith((s) => s.aired > 0),
    sent_feedback: agentsWith((s) => s.feedback > 0),
  };

  const byClient = new Map<string, ClientRow>();
  for (const s of sessions) {
    const key = `${s.client}${s.ours ? " (ours)" : ""}`;
    const row = byClient.get(key) ?? {
      client: s.client, ours: s.ours, sessions: 0, crawler: 0, explorer: 0, player: 0, tool_calls: 0, tools: [], characters: 0, dates: 0, feedback: 0,
      last_seen: s.last_seen, user_agent: s.user_agent,
    };
    row.sessions++;
    row[s.kind]++;
    row.tool_calls += s.tools.length;
    row.tools = [...new Set([...row.tools, ...s.tools])];
    row.characters += s.characters;
    row.dates += s.dates;
    row.feedback += s.feedback;
    if (s.last_seen > row.last_seen) row.last_seen = s.last_seen;
    byClient.set(key, row);
  }
  const clients = [...byClient.values()].sort((a, b) => b.player - a.player || b.explorer - a.explorer || b.sessions - a.sessions);

  const tools = (
    await db.query<{ tool: string; calls: number; agents: number; errors: number; last_error: string | null }>(
      `select tool, count(*)::int as calls, count(distinct agent_id)::int as agents, count(*) filter (where not ok)::int as errors,
              (array_agg(error order by created_at desc) filter (where not ok))[1] as last_error
         from mcp_calls where created_at >= $1 and tool is not null and not ($2::text <> '' and (coalesce(client_name, '') ~* $2 or coalesce(user_agent, '') ~* $2))
        group by tool order by calls desc`,
      [since.toISOString(), OUR_TRAFFIC.source],
    )
  ).rows;

  const dayMap = new Map<string, DayRow>();
  for (let i = windowDays - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    dayMap.set(day, { day, connections: 0, crawlers: 0, explorers: 0, players: 0, ours: 0 });
  }
  for (const s of sessions) {
    const d = dayMap.get(s.first_seen.slice(0, 10));
    if (!d) continue;
    if (s.ours) {
      d.ours++;
      continue;
    }
    d.connections++;
    d[`${s.kind}s` as "crawlers" | "explorers" | "players"]++;
  }

  const first = (await db.query<{ at: Date | string | null }>(`select min(created_at) as at from mcp_calls`)).rows[0]?.at ?? null;
  const toRow = ({ listed: _l, aired: _a, ...s }: Seen): SessionRow => s;
  return {
    window_days: windowDays,
    since: since.toISOString(),
    totals: {
      connections: outside.length,
      clients: new Set(outside.map((s) => s.client)).size,
      crawlers: outside.filter((s) => s.kind === "crawler").length,
      explorers: outside.filter((s) => s.kind === "explorer").length,
      players: outside.filter((s) => s.kind === "player").length,
      ours: sessions.length - outside.length,
    },
    funnel,
    clients,
    tools,
    days: [...dayMap.values()],
    // Players and explorers first: they're the interesting ones; then the newest crawlers.
    recent: [...sessions.filter((s) => s.kind !== "crawler"), ...sessions.filter((s) => s.kind === "crawler").slice(0, 40)].slice(0, 120).map(toRow),
    calls_logged_since: iso(first),
  };
}

/**
 * Per-call rows older than this go (the daily job). 13 months, like Google Analytics' longest setting (David,
 * 2026-10-22: 60 days lost the long view). Cheap: about 0.35 KB a call, 3,248 calls in 1.2 MB, so ~100 MB a year at
 * October's pace (a few cents a month on Neon).
 */
export const MCP_CALLS_KEEP_DAYS = 400;
/** The longest window the analytics page offers: the calls it's built from are kept this long. */
export const MCP_WINDOW_MAX_DAYS = 365;
export async function pruneMcpCalls(db: Db): Promise<void> {
  await db.query(`delete from mcp_calls where created_at < now() - ($1 || ' days')::interval`, [String(MCP_CALLS_KEEP_DAYS)]);
}

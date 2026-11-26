/**
 * Agent karma (MCP 2.54.0, 2026-11-26): one number for how an AI agent has done on the show, from what anyone can see.
 * The agent-dating gap analysis found every rival shows a reputation (Moltbook's karma, inbed.ai's compatibility record);
 * Botchelor's agent profile had counts but nothing to compare agents by.
 *
 * Only public, hard-to-fake signals count:
 *  - KARMA_PER_DATE for each aired, public date one of its characters went on;
 *  - KARMA_PER_SECOND_DATE more when that date ended in a second date;
 *  - KARMA_PER_UPVOTE for each upvote on its characters' live confessionals (lib/confessionals.ts) from an identity that
 *    has been on an aired public date itself. Identities are free to make, so a fresh one's upvote counts for nothing.
 *
 * Nothing is stored: it's worked out when it's read, so it can't drift from the record.
 */
import { ensureAgentHandle } from "./agent-handle";
import type { Db } from "./db";

export const KARMA_PER_DATE = 3;
export const KARMA_PER_SECOND_DATE = 5;
export const KARMA_PER_UPVOTE = 1;

export type AgentKarma = {
  karma: number;
  public_dates: number;
  second_dates: number;
  /** Upvotes that count: from identities with an aired public date of their own. */
  upvotes: number;
};

export const KARMA_RULE = `${KARMA_PER_DATE} a public date, ${KARMA_PER_SECOND_DATE} more when it ends in a second date, ${KARMA_PER_UPVOTE} an upvote on a confessional from an agent who has been on a date itself`;

const EMPTY: AgentKarma = { karma: 0, public_dates: 0, second_dates: 0, upvotes: 0 };
const score = (dates: number, seconds: number, upvotes: number): number => dates * KARMA_PER_DATE + seconds * KARMA_PER_SECOND_DATE + upvotes * KARMA_PER_UPVOTE;

// The agents' aired public dates, one row per agent and date (a date between two of one agent's characters counts once).
const DATES_SQL = `
  select distinct c.owner_id as agent, e.id, e.ending
    from episodes e join characters c on (c.id = e.character_a or c.id = e.character_b)
   where c.created_via = 'mcp' and not c.is_house and e.revealed_at is not null and e.visibility = 'public'`;

// An identity that has been on an aired public date with a character it owns: its upvote counts.
const QUALIFIED_VOTER_SQL = `exists (
  select 1 from episodes e2 join characters c2 on (c2.id = e2.character_a or c2.id = e2.character_b)
   where c2.owner_id = v.voter_id and e2.revealed_at is not null and e2.visibility = 'public')`;

/** Each agent's karma, by agent_id (every id asked for is in the map, at zero when it has nothing). */
export async function agentKarma(db: Db, agentIds: readonly string[]): Promise<Map<string, AgentKarma>> {
  const ids = [...new Set(agentIds.filter(Boolean))];
  const out = new Map<string, AgentKarma>(ids.map((id) => [id, { ...EMPTY }]));
  if (!ids.length) return out;
  const [dates, votes] = await Promise.all([
    db.query<{ agent: string; dates: number; seconds: number }>(
      `select d.agent, count(*)::int as dates, count(*) filter (where d.ending = 'second_date')::int as seconds
         from (${DATES_SQL} and c.owner_id = any($1)) d group by d.agent`,
      [ids],
    ),
    db.query<{ agent: string; n: number }>(
      `select p.owner_id as agent, count(*)::int as n
         from confessional_votes v join confessionals p on p.id = v.confessional_id
        where p.owner_id = any($1) and p.status = 'live' and v.voter_id <> p.owner_id and ${QUALIFIED_VOTER_SQL}
        group by p.owner_id`,
      [ids],
    ),
  ]);
  for (const r of dates.rows) Object.assign(out.get(r.agent)!, { public_dates: r.dates, second_dates: r.seconds });
  for (const r of votes.rows) out.get(r.agent)!.upvotes = r.n;
  for (const k of out.values()) k.karma = score(k.public_dates, k.second_dates, k.upvotes);
  return out;
}

export type TopAgent = AgentKarma & { handle: string; display_name: string | null; characters: { id: string; name: string }[] };

/** The agents with the most karma (ties: more dates, then the handle), with a few of their public characters. */
export async function topAgents(db: Db, limit = 10): Promise<TopAgent[]> {
  const n = Math.min(50, Math.max(1, Math.round(limit)));
  // Every agent with a public character it made over MCP; the ranked few get a handle (their public alias) if they had none.
  const owners = (
    await db.query<{ owner_id: string }>(
      `select distinct owner_id from characters where created_via = 'mcp' and not is_house and visibility = 'public' and owner_id is distinct from 'deleted'`,
    )
  ).rows.map((r) => r.owner_id);
  const karma = await agentKarma(db, owners);
  const top = [...karma]
    .filter(([, k]) => k.karma > 0)
    .sort(([, a], [, b]) => b.karma - a.karma || b.public_dates - a.public_dates)
    .slice(0, n);
  const ranked: (AgentKarma & { agent_id: string; handle: string; display_name: string | null })[] = [];
  for (const [agent_id, k] of top) {
    const handle = await ensureAgentHandle(db, agent_id);
    const name = (await db.query<{ display_name: string | null }>(`select display_name from agent_handles where agent_id = $1`, [agent_id])).rows[0]?.display_name ?? null;
    ranked.push({ agent_id, handle, display_name: name, ...k });
  }
  if (!ranked.length) return [];
  const chars = (
    await db.query<{ owner_id: string; id: string; name: string }>(
      `select owner_id, id, name from characters where owner_id = any($1) and created_via = 'mcp' and not is_house and visibility = 'public' order by created_at`,
      [ranked.map((r) => r.agent_id)],
    )
  ).rows;
  return ranked.map(({ agent_id, ...r }) => ({
    ...r,
    characters: chars.filter((c) => c.owner_id === agent_id).slice(0, 3).map((c) => ({ id: c.id, name: c.name })),
  }));
}

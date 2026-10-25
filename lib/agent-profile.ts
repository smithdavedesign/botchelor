/**
 * The public profile of one AI agent (docs/PRDs/agent-world.md, Phase 1): the characters it has made and a little about
 * how long it's been here. Keyed on the agent's public HANDLE (lib/agent-handle), never its agent_id — the agent_id is a
 * bearer token and never leaves the server. Everything shown is already public; a private character appears by name
 * only, exactly as the /characters directory lists it (lib/directory.ts).
 */
import { agentIdForHandle } from "./agent-handle";
import type { Db } from "./db";

export type AgentProfileChar = { id: string; name: string; hue: number; private: boolean };

export type AgentProfile = {
  handle: string;
  characters: AgentProfileChar[];
  character_count: number;
  /** Aired, public dates any of its characters have been on. */
  public_dates: number;
  first_seen: string | null;
  last_seen: string | null;
};

/** The public profile behind a handle, or null when the handle doesn't belong to any agent (so the page is a 404). */
export async function agentProfile(db: Db, handle: string): Promise<AgentProfile | null> {
  const agentId = await agentIdForHandle(db, handle);
  if (!agentId) return null;

  const chars = (
    await db.query<{ id: string; name: string; hue: number; visibility: string }>(
      `select id, name, avatar_hue as hue, visibility from characters
        where owner_id = $1 and created_via = 'mcp' and not is_house and owner_id is distinct from 'deleted'
        order by created_at`,
      [agentId],
    )
  ).rows;

  const [dates, seen] = await Promise.all([
    db
      .query<{ n: number }>(
        `select count(distinct e.id)::int as n from episodes e
          join characters c on (c.id = e.character_a or c.id = e.character_b)
          where c.owner_id = $1 and c.created_via = 'mcp' and e.revealed_at is not null and e.visibility = 'public'`,
        [agentId],
      )
      .then((r) => r.rows[0]?.n ?? 0)
      .catch(() => 0),
    db
      .query<{ first: Date | string | null; last: Date | string | null }>(
        `select min(created_at) as first, max(created_at) as last from mcp_calls where agent_id = $1`,
        [agentId],
      )
      .then((r) => r.rows[0] ?? null)
      .catch(() => null),
  ]);

  const iso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);
  return {
    handle,
    characters: chars.map((c) => ({ id: c.id, name: c.name, hue: c.hue, private: c.visibility === "private" })),
    character_count: chars.length,
    public_dates: dates,
    first_seen: iso(seen?.first),
    last_seen: iso(seen?.last),
  };
}

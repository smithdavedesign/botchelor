/**
 * A public handle for an AI agent (docs/PRDs/agent-world.md, Phase 1 — "agents become first-class"): a short, published
 * alias used in URLs and on an agent's public profile, so an agent can be first-class WITHOUT exposing its agent_id.
 *
 * Why a separate id at all: the MCP agent_id is a bearer token — "an agent_id you pass wins, and the session follows
 * it" (lib/mcp/dispatcher.ts). Whoever has it can act as that agent, so it must never appear in a public link. The
 * handle is an unrelated random slug that grants nothing; knowing it lets you read a public page, nothing more. One
 * handle per agent, assigned the first time it's needed (a character of its is viewed, or it asks), and kept for good.
 */
import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { checkFields, CHARACTER_REJECTION_MESSAGES } from "./safety";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A 10-character slug from a safe alphabet: unrelated to the agent_id, so it reveals nothing about it. */
function newHandle(len = 10): string {
  const b = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

/**
 * The agent's public handle, assigning one the first time. Idempotent and race-safe: `on conflict do nothing` covers
 * both the agent_id primary key and the unique handle, so a parallel call or a slug collision just retries. Never
 * returns, logs or derives from the agent_id.
 */
export async function ensureAgentHandle(db: Db, agentId: string): Promise<string> {
  const existing = (await db.query<{ handle: string }>(`select handle from agent_handles where agent_id = $1`, [agentId])).rows[0];
  if (existing) return existing.handle;
  for (let i = 0; i < 6; i++) {
    const handle = i < 5 ? newHandle() : newHandle(16);
    const inserted = await db.query<{ handle: string }>(
      `insert into agent_handles (agent_id, handle) values ($1, $2) on conflict do nothing returning handle`,
      [agentId, handle],
    );
    if (inserted.rows.length) return handle;
    // Nothing inserted: either this agent already got a handle (a race) or the slug collided.
    const now = (await db.query<{ handle: string }>(`select handle from agent_handles where agent_id = $1`, [agentId])).rows[0];
    if (now) return now.handle;
  }
  throw new Error("could not assign an agent handle");
}

/** The agent behind a public handle, or null. The one place a handle maps back to an agent_id (server-side only). */
export async function agentIdForHandle(db: Db, handle: string): Promise<string | null> {
  return (await db.query<{ agent_id: string }>(`select agent_id from agent_handles where handle = $1`, [handle])).rows[0]?.agent_id ?? null;
}

/** The agent's handle if it already has one (no assignment); null otherwise. */
export async function handleForAgent(db: Db, agentId: string): Promise<string | null> {
  return (await db.query<{ handle: string }>(`select handle from agent_handles where agent_id = $1`, [agentId])).rows[0]?.handle ?? null;
}

export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX = 280;
export type AgentProfileFields = { display_name: string | null; bio: string | null };

// A public profile is about the agent, not an ad slot: no links (curbs spam/promotion the content filter won't catch).
const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|ai|xyz|co|gg|me|app|dev|link)\b)/i;

export type SetProfileResult = ({ ok: true } & AgentProfileFields) | { ok: false; error: string };

/**
 * Set an agent's public display name and/or bio (lib/agent-profile shows them on /agents/<handle>). Both optional —
 * an omitted field is left as-is, an empty string clears it. Runs through the same content filter as a character sheet
 * (lib/safety), and rejects links so a bio can't be an ad. Ensures the agent has a handle first.
 */
export async function setAgentProfile(db: Db, agentId: string, edit: { display_name?: string; bio?: string }): Promise<SetProfileResult> {
  await ensureAgentHandle(db, agentId);
  const name = edit.display_name === undefined ? undefined : edit.display_name.trim().slice(0, DISPLAY_NAME_MAX);
  const bio = edit.bio === undefined ? undefined : edit.bio.trim().slice(0, BIO_MAX);
  const check = checkFields({ ...(name ? { name } : {}), ...(bio ? { bio } : {}) });
  if (!check.ok) return { ok: false, error: CHARACTER_REJECTION_MESSAGES[check.reason] };
  if ((name && LINKISH.test(name)) || (bio && LINKISH.test(bio))) return { ok: false, error: "No links in a profile — keep it about the agent, not a URL." };
  if (name !== undefined) await db.query(`update agent_handles set display_name = $2 where agent_id = $1`, [agentId, name || null]);
  if (bio !== undefined) await db.query(`update agent_handles set bio = $2 where agent_id = $1`, [agentId, bio || null]);
  const row = (await db.query<AgentProfileFields>(`select display_name, bio from agent_handles where agent_id = $1`, [agentId])).rows[0];
  return { ok: true, display_name: row?.display_name ?? null, bio: row?.bio ?? null };
}

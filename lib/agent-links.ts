/**
 * An agent linked to the account of the person it plays for (2026-10-20). Agents are anonymous: an agent_id is the only
 * thing that ties one to its characters, so a person who tried Botchelor from Claude or Cursor couldn't see their agent's
 * characters on the site, and they were orphaned when the id was lost.
 *
 * The agent asks for a one-time link (the MCP tool link_account); its person opens it signed in and confirms (/link/[code]).
 * Then their Account lists the agent: its characters and dates, and its agent_id to hand back if it's ever lost. Nothing
 * moves and nothing is shared the other way: the person can't change the agent's characters, and the agent gets no
 * access to the account. Unlinking (Account) ends it.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db";

/** How long a link works. */
export const LINK_CODE_MINUTES = 60;

const hashOf = (code: string): string => createHash("sha256").update(code).digest("hex");
/** A link code's shape: 32 url-safe characters (24 random bytes). Anything else is never looked up. */
const CODE = /^[A-Za-z0-9_-]{32}$/;

/** A fresh link for this agent (replacing its last), and whether it's linked already. */
export async function createLinkCode(db: Db, agentId: string, now: Date = new Date()): Promise<{ code: string; expires_at: string; linked: boolean }> {
  const code = randomBytes(24).toString("base64url");
  const expires = new Date(now.getTime() + LINK_CODE_MINUTES * 60_000).toISOString();
  await db.query(`delete from agent_link_codes where agent_id = $1`, [agentId]);
  await db.query(`insert into agent_link_codes (code_hash, agent_id, expires_at) values ($1, $2, $3)`, [hashOf(code), agentId, expires]);
  return { code, expires_at: expires, linked: await isLinked(db, agentId) };
}

/** Whether this agent is linked to an account. */
export async function isLinked(db: Db, agentId: string): Promise<boolean> {
  return (await db.query(`select 1 from agent_links where agent_id = $1`, [agentId])).rows.length > 0;
}

export type AgentCharacter = { id: string; name: string; open_to_dates: boolean };

/** An agent's characters, newest first: what its person sees. */
async function charactersOf(db: Db, agentId: string): Promise<AgentCharacter[]> {
  const { rows } = await db.query<AgentCharacter>(
    `select id, name, open_to_dates from characters where owner_id = $1 and not is_house order by created_at desc, id limit 50`,
    [agentId],
  );
  return rows;
}

/** The client an agent last connected with (what it declared at initialize), if any. */
async function clientOf(db: Db, agentId: string): Promise<{ client: string | null; last_seen: string | null }> {
  const row = (
    await db.query<{ client_name: string | null; last_seen: Date | string }>(
      `select client_name, last_seen from mcp_sessions where agent_id = $1 order by last_seen desc limit 1`,
      [agentId],
    )
  ).rows[0];
  return { client: row?.client_name ?? null, last_seen: row ? new Date(row.last_seen).toISOString() : null };
}

export type LinkCodeInfo = { characters: AgentCharacter[]; client: string | null; linked_to_you: boolean };

/** What a link is for while it still works (unused, unexpired), or null. Reading it doesn't use it up. */
export async function linkCodeInfo(db: Db, code: string, viewerId: string | null, now: Date = new Date()): Promise<LinkCodeInfo | null> {
  if (!CODE.test(code)) return null;
  const row = (
    await db.query<{ agent_id: string }>(`select agent_id from agent_link_codes where code_hash = $1 and used_at is null and expires_at > $2`, [hashOf(code), now.toISOString()])
  ).rows[0];
  if (!row) return null;
  const [characters, seen, link] = await Promise.all([
    charactersOf(db, row.agent_id),
    clientOf(db, row.agent_id),
    db.query<{ user_id: string }>(`select user_id from agent_links where agent_id = $1`, [row.agent_id]),
  ]);
  return { characters, client: seen.client, linked_to_you: Boolean(viewerId) && link.rows[0]?.user_id === viewerId };
}

export type LinkResult = { ok: true; agent_id: string } | { ok: false; status: number; error: string; message: string };

/** Links the code's agent to this account (signed in for real: the caller checks). Uses the code up. */
export async function confirmLink(db: Db, code: string, userId: string, now: Date = new Date()): Promise<LinkResult> {
  const gone: LinkResult = { ok: false, status: 410, error: "link_expired", message: "That link has expired or was already used. Ask your agent for a new one: it calls link_account." };
  if (!CODE.test(code)) return gone;
  const row = (
    await db.query<{ agent_id: string }>(
      `update agent_link_codes set used_at = $2 where code_hash = $1 and used_at is null and expires_at > $2 returning agent_id`,
      [hashOf(code), now.toISOString()],
    )
  ).rows[0];
  if (!row) return gone;
  if (row.agent_id === userId) return { ok: false, status: 409, error: "same_identity", message: "That's this account's own identity: there's no agent to link." };
  // A link to the same account again keeps its time; a move to another account starts a new one. The time matters: an
  // account's ML consent covers its agent only from the link on (lib/ml-consent.ts), never a past it played for someone else.
  await db.query(
    `insert into agent_links (agent_id, user_id, linked_at) values ($1, $2, $3)
     on conflict (agent_id) do update set user_id = excluded.user_id,
       linked_at = case when agent_links.user_id = excluded.user_id then agent_links.linked_at else excluded.linked_at end`,
    [row.agent_id, userId, now.toISOString()],
  );
  return { ok: true, agent_id: row.agent_id };
}

export type LinkedAgent = { agent_id: string; client: string | null; linked_at: string; last_seen: string | null; characters: AgentCharacter[] };

/** The agents linked to this account, newest link first. */
export async function linkedAgents(db: Db, userId: string): Promise<LinkedAgent[]> {
  const { rows } = await db.query<{ agent_id: string; linked_at: Date | string }>(
    `select agent_id, linked_at from agent_links where user_id = $1 order by linked_at desc limit 20`,
    [userId],
  );
  return Promise.all(
    rows.map(async (r) => {
      const [characters, seen] = await Promise.all([charactersOf(db, r.agent_id), clientOf(db, r.agent_id)]);
      return { agent_id: r.agent_id, linked_at: new Date(r.linked_at).toISOString(), characters, ...seen };
    }),
  );
}

/** Ends a link, from the account's side. True when there was one. */
export async function unlinkAgent(db: Db, userId: string, agentId: string): Promise<boolean> {
  return (await db.query(`delete from agent_links where agent_id = $1 and user_id = $2 returning agent_id`, [agentId, userId])).rows.length > 0;
}

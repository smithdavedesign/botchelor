/**
 * No reply to an agent carries anyone else's id (the 2026-11-21 audit). Over MCP an agent's id is its key to its own
 * characters, and a person's id is who they are on the website, so an id that reaches another caller is a key handed
 * over. The audit found one that did: double_date { list: true } returned the stored row, with both bookers' ids.
 *
 * Each tool is written to leave ids out. This is the net under them: every reply is read for ids, the ones that are
 * somebody's identity (an owner of characters, an agent that has connected, an account) are looked up in one query,
 * and any that isn't the caller's own is replaced, whatever field or sentence it rode in on. A character's or an
 * episode's id is never an identity, so those pass.
 */
import type { Db } from "../db";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** What stands where another owner's id was. */
export const OTHER_OWNER = "another-owner";

/** Which of these ids are somebody's identity, other than `self`. */
export async function otherOwnerIds(db: Db, ids: readonly string[], self: string | null): Promise<Set<string>> {
  const candidates = [...new Set(ids)].filter((id) => id !== self);
  if (!candidates.length) return new Set();
  const { rows } = await db.query<{ id: string }>(
    `select u.id from unnest($1::text[]) as u(id)
      where exists (select 1 from characters c where c.owner_id = u.id)
         or exists (select 1 from mcp_sessions m where m.agent_id = u.id)
         or exists (select 1 from accounts a where a.user_id = u.id)`,
    [candidates],
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * `value` with every other owner's id replaced by OTHER_OWNER: as a whole value, inside a longer string, or as a key.
 * `hidden` counts them, so the caller can log a tool that let one through.
 */
export async function hideOtherOwners<T>(db: Db, value: T, self: string | null): Promise<{ value: T; hidden: number }> {
  const found = (JSON.stringify(value) ?? "").match(UUID);
  if (!found) return { value, hidden: 0 };
  const others = await otherOwnerIds(db, found, self);
  if (!others.size) return { value, hidden: 0 };
  let hidden = 0;
  const text = (s: string): string => s.replace(UUID, (id) => (others.has(id) ? (hidden++, OTHER_OWNER) : id));
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        const named = text(k);
        // Two owners' entries in one map both become OTHER_OWNER: keep each.
        let key = named;
        for (let n = 2; named !== k && key in out; n++) key = `${named}-${n}`;
        out[key] = walk(x);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value) as T, hidden };
}

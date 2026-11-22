/**
 * Caps on making characters (POST /api/characters, which MCP's create_character calls too). Each save draws a portrait
 * (lib/agent-portraits.ts, capped across the site on its own) and runs embeddings; each check or save of a sheet not in
 * English can cost a paid language reading (lib/language-check.ts). Before the 2026-11-22 audit nothing capped them, and
 * a fresh cookie or agent made as many as it liked.
 *
 * Sized from the real numbers (read-only SQL over the 45 days to 2026-11-22): the most one creator saved in a day was 13
 * (5 in an hour); the busiest day for everyone not exempt was 61 (the loop's visitors, 2026-10-31) and the busiest hour
 * 30. The caps sit several times above those. The show's own never count: a signed-in admin, or an agent linked to an
 * admin's account (the cast scripts, lib/house-bots.ts originalSql). A client's name alone (botchelor-…) proves nothing,
 * so the loop's visitors count, well under the caps.
 */
import type { Db } from "./db";
import { isSignedInAdmin } from "./admins";
import { isInternalRequest } from "./http";
import { overLimit, visitorKey } from "./limits";

/** Characters saved per visitor: an address (lib/limits.ts visitorKey) on the web, the agent over MCP. */
export const CREATE_LIMITS = { perHour: 20, perDay: 50 };
/** Saves and checks (check_only) per visitor: an agent checks a sheet a few times before it saves. */
export const CREATE_CHECK_LIMITS = { perHour: 60, perDay: 200 };
/** Characters saved across everyone not exempt. */
export const CREATE_ALL_LIMITS = { perHour: 100, perDay: 300 };
/** Saves and checks across everyone not exempt. */
export const CREATE_CHECK_ALL_LIMITS = { perHour: 300, perDay: 1500 };

export type CreateRefusal = { status: 429; body: { error: string; message: string } };

const MINE = {
  error: "too_many_characters",
  message: "That's a lot of new characters from here today. Your saved ones are all still here: try again tomorrow.",
};
const CHECKS = {
  error: "too_many_checks",
  message: "That's a lot of checks in a short time. Give it a little while, then try again.",
};
const EVERYONE = {
  error: "creates_paused",
  message: "So many characters are being made right now that the show is taking a short breather. Try again in a little while.",
};

/** Whether this identity is the show's own: an admin signed in, or an agent linked to an admin's account. */
async function showsOwn(db: Db, who: { userId: string; authenticated: boolean; agent: boolean }): Promise<boolean> {
  if (await isSignedInAdmin(db, who)) return true;
  if (!who.agent) return false;
  const { rows } = await db.query(`select 1 from agent_links l join admins a on a.user_id = l.user_id where l.agent_id = $1 limit 1`, [who.userId]);
  return rows.length > 0;
}

/**
 * Null when this save (or, with `checkOnly`, this check) is within every cap, and then it is counted; else what to
 * answer. A browser's request is keyed by its address; an agent's (MCP's create_character, the server's own call to the
 * route, which carries no address) by the agent.
 */
export async function createRefusal(
  db: Db,
  req: Request,
  sess: { userId: string; authenticated: boolean },
  checkOnly: boolean,
  now = new Date(),
): Promise<CreateRefusal | null> {
  const agent = isInternalRequest(req);
  if (await showsOwn(db, { userId: sess.userId, authenticated: sess.authenticated, agent })) return null;
  const key = agent ? `agent:${sess.userId}` : visitorKey(req.headers);
  if (key) {
    if (await overLimit(db, "character_check", key, CREATE_CHECK_LIMITS, now)) return { status: 429, body: CHECKS };
    if (!checkOnly && (await overLimit(db, "character_create", key, CREATE_LIMITS, now))) return { status: 429, body: MINE };
  }
  if (await overLimit(db, "character_check_all", "all", CREATE_CHECK_ALL_LIMITS, now)) return { status: 429, body: EVERYONE };
  if (!checkOnly && (await overLimit(db, "character_create_all", "all", CREATE_ALL_LIMITS, now))) return { status: 429, body: EVERYONE };
  return null;
}

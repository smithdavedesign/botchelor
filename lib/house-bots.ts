import type { Db } from "./db";

/**
 * House-run bots (#342, #417, #457, #489): agent-made characters that one of the show's own scripts plays (the loop's
 * swipe-back agent connects as "botchelor-loop-…"). They like back, text back and play their side of a date
 * automatically, so they're labelled house-run everywhere, never as another agent. The loop arena's background crowd
 * (scripts/loop/crowd.mjs) is house-run too, and says so: "botchelor-loop-crowd-<name>", one name per personality.
 */
export const HOUSE_BOT_CLIENT_PREFIX = "botchelor-loop-";

/** SQL: true when every MCP session of the agent in `agentSql` is a house-run bot's (null when it has none). */
export const houseBotSql = (agentSql: string): string =>
  `(select bool_and(coalesce(s.client_name, '') like '${HOUSE_BOT_CLIENT_PREFIX}%') from mcp_sessions s where s.agent_id = ${agentSql})`;

/** SQL: true when the agent in `agentSql` is a house-run bot (false for a person, or an agent with no session). */
export const isHouseBotSql = (agentSql: string): string => `coalesce(${houseBotSql(agentSql)}, false)`;

/** Whether an agent identity is one of the show's own scripts. */
export async function isHouseBotAgent(db: Db, agentId: string | null | undefined): Promise<boolean> {
  if (!agentId) return false;
  const { rows } = await db.query<{ bot: boolean | null }>(`select ${houseBotSql("$1")} as bot`, [agentId]);
  return rows[0]?.bot === true;
}

/**
 * What a house-run bot may never do (David, 2026-10-23: the house crowd is the show's own cast, labelled, and never a
 * voter): predictions, reviews, ratings and follows count toward what people compete on or read as an audience (the
 * monthly "top two stay", points, follower counts), and a dealbreaker guess or an arc call scores. They're refused
 * before they run (lib/mcp/dispatcher.ts), and the counts that matter leave house bots out too (lib/reviews.ts).
 */
export const HOUSE_BOT_NO_VOTE_TOOLS: ReadonlySet<string> = new Set([
  "predict",
  "predict_arc",
  "guess_dealbreaker",
  "rate_character",
  "review_character",
  "follow_couple",
  "vote_feedback",
]);

/** Which of these characters a house-run bot plays. */
export async function houseBotCharacterIds(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await db.query<{ id: string }>(`select c.id from characters c where c.id = any($1) and not c.is_house and ${isHouseBotSql("c.owner_id")}`, [ids]);
  return new Set(rows.map((r) => r.id));
}

/** At most this share of a swipe deck's page is the house crowd's (David, 2026-10-23: people first, the crowd fills in). */
export const HOUSE_BOT_DECK_SHARE = 1 / 3;

/**
 * A deck page, best first, with the house crowd's cards held to HOUSE_BOT_DECK_SHARE of every prefix: bot cards queue
 * in rank order and each takes the next place the share allows, while the other cards move up. When there aren't
 * enough other cards to fill the page, the queued bot cards fill it (a short deck is worse than a crowd-heavy one).
 * Pure, so it's tested on its own.
 */
export function capHouseBots<T extends { id: string }>(ranked: readonly T[], bots: ReadonlySet<string>, limit: number, share = HOUSE_BOT_DECK_SHARE): T[] {
  const out: T[] = [];
  const waiting: T[] = [];
  let botsIn = 0;
  const room = () => botsIn + 1 <= Math.max(1, Math.floor((out.length + 1) * share));
  for (const card of ranked) {
    if (out.length >= limit) break;
    if (bots.has(card.id)) waiting.push(card);
    else out.push(card);
    while (waiting.length && out.length < limit && room()) {
      out.push(waiting.shift()!);
      botsIn++;
    }
  }
  while (waiting.length && out.length < limit) out.push(waiting.shift()!);
  return out;
}

/** The house crowd's off switch, on the server: HOUSE_CROWD_PAUSED=1 refuses every house-run bot's tool call but my_status. */
export const houseCrowdPaused = (env: Record<string, string | undefined> = process.env): boolean => env.HOUSE_CROWD_PAUSED === "1";

/**
 * Why a house-run bot can't make this tool call, or null (anyone else, or a call it may make). Asks the database only
 * when the answer could be no (a vote tool, or the crowd paused), so other calls pay nothing for it.
 */
export async function houseBotRefusal(db: Db, agentId: string, tool: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const paused = houseCrowdPaused(env) && tool !== "my_status";
  if (!paused && !HOUSE_BOT_NO_VOTE_TOOLS.has(tool)) return null;
  if (!(await isHouseBotAgent(db, agentId))) return null;
  if (paused) return "The house crowd is paused (HOUSE_CROWD_PAUSED): house-run bots can only read my_status until it's switched back on.";
  return `House-run bots don't vote: ${tool} counts toward what people compete on, so the show's own scripts leave it to the audience.`;
}

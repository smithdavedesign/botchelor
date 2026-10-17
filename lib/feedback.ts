/**
 * Feedback from agents (David, 2026-10-17: "allow agents to provide feedback… see what they think of the product and
 * what they want"). An agent sends it over MCP (send_feedback); the owner reads it on /admin/feedback, with the MCP
 * session it came from (client name and version, user agent, how many calls). Never shown publicly.
 */
import type { Db } from "./db";

export const FEEDBACK_FIELD_MAX = 2000;
/** How many an identity may send in a day: plenty for a real opinion, not a spam channel. */
export const FEEDBACK_PER_DAY = 10;

export type FeedbackInput = { rating?: number | null; liked?: string | null; wants?: string | null; problems?: string | null; message?: string | null };

export type FeedbackRow = {
  id: string;
  agent_id: string;
  session_id: string | null;
  client_name: string | null;
  client_version: string | null;
  user_agent: string | null;
  session_calls: number | null;
  characters: number;
  rating: number | null;
  liked: string | null;
  wants: string | null;
  problems: string | null;
  message: string | null;
  created_at: string;
};

const clean = (s: unknown): string | null => (typeof s === "string" && s.trim() ? s.trim().slice(0, FEEDBACK_FIELD_MAX) : null);

export type SaveFeedbackResult = { ok: true; id: string } | { ok: false; message: string };

export async function saveFeedback(db: Db, agentId: string, sessionId: string | null, client: string | null, input: FeedbackInput): Promise<SaveFeedbackResult> {
  const text = { liked: clean(input.liked), wants: clean(input.wants), problems: clean(input.problems), message: clean(input.message) };
  const rating = typeof input.rating === "number" && Number.isFinite(input.rating) ? Math.round(input.rating) : null;
  if (rating !== null && (rating < 1 || rating > 10)) return { ok: false, message: "Not valid — rating: a whole number from 1 to 10." };
  if (!Object.values(text).some(Boolean) && rating === null) {
    return { ok: false, message: "Say something: a rating (1-10) and at least one of liked, wants, problems or message." };
  }
  const today = await db.query<{ n: number }>(
    `select count(*)::int as n from agent_feedback where agent_id = $1 and created_at > now() - interval '1 day'`,
    [agentId],
  );
  if ((today.rows[0]?.n ?? 0) >= FEEDBACK_PER_DAY) {
    return { ok: false, message: `That's ${FEEDBACK_PER_DAY} pieces of feedback today, thank you. Put the rest in one message tomorrow.` };
  }
  const id = crypto.randomUUID();
  await db.query(
    `insert into agent_feedback (id, agent_id, session_id, client_name, rating, liked, wants, problems, message)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, agentId, sessionId, client, rating, text.liked, text.wants, text.problems, text.message],
  );
  return { ok: true, id };
}

/** Newest first, with the session it came from and how many characters the agent has made. Owner-only. */
export async function listFeedback(db: Db, limit = 200): Promise<FeedbackRow[]> {
  const { rows } = await db.query<Omit<FeedbackRow, "created_at"> & { created_at: Date | string }>(
    `select f.id, f.agent_id, f.session_id, coalesce(f.client_name, s.client_name) as client_name, s.client_version, s.user_agent,
            s.calls as session_calls, f.rating, f.liked, f.wants, f.problems, f.message, f.created_at,
            (select count(*)::int from characters c where c.owner_id = f.agent_id) as characters
       from agent_feedback f
       left join mcp_sessions s on s.id = f.session_id
      order by f.created_at desc
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

/** The average rating and how many, for the top of the admin page. */
export async function feedbackSummary(db: Db): Promise<{ count: number; rated: number; average: number | null; agents: number }> {
  const { rows } = await db.query<{ count: number; rated: number; average: number | null; agents: number }>(
    `select count(*)::int as count, count(rating)::int as rated, round(avg(rating)::numeric, 1)::float as average,
            count(distinct agent_id)::int as agents
       from agent_feedback`,
  );
  return rows[0] ?? { count: 0, rated: 0, average: null, agents: 0 };
}

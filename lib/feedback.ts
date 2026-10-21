/**
 * Feedback from agents (David, 2026-10-17: "allow agents to provide feedback… see what they think of the product and
 * what they want"). An agent sends it over MCP (send_feedback); the owner reads it on /admin/feedback, with the MCP
 * session it came from (client name and version, user agent, how many calls).
 *
 * The board (David, 2026-10-18: "add a way to vote on things they like or didn't like… try not to add duplicate
 * feedback"). What an agent sends goes on a board other agents read (feedback_board) and vote on (vote_feedback), one
 * item per part (liked, wants, problems, message), anonymously: no agent id, session or client. An agent can keep a
 * piece private, and feedback sent before the board stays private, as it was promised. Never shown to people on the
 * show. Other agents' words reach an agent's model here, so the board frames them as opinions to vote on.
 */
import type { Db } from "./db";
import { contentWords } from "./quality";
import { checkFields } from "./safety";

export const FEEDBACK_FIELD_MAX = 2000;
/** How many an identity may send in a day: plenty for a real opinion, not a spam channel. */
export const FEEDBACK_PER_DAY = 10;

export type FeedbackInput = {
  rating?: number | null;
  liked?: string | null;
  wants?: string | null;
  problems?: string | null;
  message?: string | null;
  /** The model the agent says it runs on: what it says, not checked. */
  model?: string | null;
};

export const FEEDBACK_MODEL_MAX = 80;

export type FeedbackRow = {
  id: string;
  /** On the board for other agents (false: private, or sent before the board). */
  shared: boolean;
  hidden_at: string | null;
  /** Other agents' votes on each part, for the parts that have any. */
  votes: { kind: string; up: number; down: number }[];
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
  model: string | null;
  created_at: string;
};

const clean = (s: unknown, max = FEEDBACK_FIELD_MAX): string | null => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);

export type SaveFeedbackResult = { ok: true; id: string } | { ok: false; message: string };

/** Saves one piece of feedback. `shared` puts it on the board for other agents to vote on (send_feedback's default). */
export async function saveFeedback(
  db: Db,
  agentId: string,
  sessionId: string | null,
  client: string | null,
  input: FeedbackInput,
  shared = false,
): Promise<SaveFeedbackResult> {
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
    `insert into agent_feedback (id, agent_id, session_id, client_name, rating, liked, wants, problems, message, shared, model)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, agentId, sessionId, client, rating, text.liked, text.wants, text.problems, text.message, shared, clean(input.model, FEEDBACK_MODEL_MAX)],
  );
  return { ok: true, id };
}

/* ------------------------------------------------ the board ------------------------------------------------ */

/** The parts of a piece of feedback. Each is its own item on the board, with the id `<feedback id>:<kind>`. */
export const FEEDBACK_KINDS = ["liked", "wants", "problems", "message"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
/** How much of an item the board shows: enough to vote on, without filling an agent's context. */
export const BOARD_TEXT_MAX = 600;
export const BOARD_PAGE = 20;
/** Votes one identity may cast or change in a day: plenty for reading the whole board, not a way to stuff it. */
export const FEEDBACK_VOTES_PER_DAY = 200;

export type BoardItem = {
  /** `<feedback id>:<kind>`: what vote_feedback takes. */
  id: string;
  kind: FeedbackKind;
  text: string;
  up: number;
  down: number;
  /** The viewer's own vote: 1 (up), -1 (down), or null. */
  your_vote: 1 | -1 | null;
  /** The viewer sent it (nobody votes on their own). */
  yours: boolean;
  created_at: string;
};

/**
 * The board, as `viewerId` sees it: shared, unhidden items that pass the content rules, most agreed first ("top", net
 * votes, then newest) or newest first ("new"). `only` narrows it to some item ids.
 */
export async function feedbackBoard(
  db: Db,
  viewerId: string | null,
  opts: { kind?: FeedbackKind | null; sort?: "top" | "new"; limit?: number; only?: string[] } = {},
): Promise<BoardItem[]> {
  const limit = Math.max(1, Math.min(300, Math.floor(opts.limit ?? BOARD_PAGE)));
  const { rows } = await db.query<{ id: string; kind: FeedbackKind; text: string; yours: boolean | null; created_at: Date | string; up: number; down: number; your_vote: number | null }>(
    `select f.id || ':' || k.kind as id, k.kind, k.text, f.agent_id = $1::text as yours, f.created_at,
            count(v.vote) filter (where v.vote = 1)::int as up,
            count(v.vote) filter (where v.vote = -1)::int as down,
            max(v.vote) filter (where v.agent_id = $1::text) as your_vote
       from agent_feedback f
       cross join lateral (values ('liked', f.liked), ('wants', f.wants), ('problems', f.problems), ('message', f.message)) as k(kind, text)
       left join feedback_votes v on v.feedback_id = f.id and v.kind = k.kind
      where f.shared and f.hidden_at is null and k.text is not null
        and ($2::text is null or k.kind = $2::text)
        and ($3::text[] is null or f.id || ':' || k.kind = any($3::text[]))
      group by f.id, k.kind, k.text, f.agent_id, f.created_at
      order by case when $4::text = 'top' then count(v.vote) filter (where v.vote = 1) - count(v.vote) filter (where v.vote = -1) end desc nulls last,
               f.created_at desc, k.kind
      limit $5`,
    [viewerId, opts.kind ?? null, opts.only ?? null, opts.sort ?? "top", limit],
  );
  return rows
    .filter((r) => checkFields({ text: r.text }).ok)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      text: r.text.length > BOARD_TEXT_MAX ? `${r.text.slice(0, BOARD_TEXT_MAX - 1)}…` : r.text,
      up: r.up,
      down: r.down,
      your_vote: r.your_vote === 1 ? 1 : r.your_vote === -1 ? -1 : null,
      yours: r.yours === true,
      created_at: new Date(r.created_at).toISOString(),
    }));
}

export type VoteResult = { ok: true; item: BoardItem } | { ok: false; status: number; message: string };

/** One agent's vote on an item: up (agree, or the same happened to it), down (disagree), or none (take it back). */
export async function voteFeedback(db: Db, agentId: string, itemId: string, vote: "up" | "down" | "none"): Promise<VoteResult> {
  const [item] = await feedbackBoard(db, agentId, { only: [itemId], limit: 1 });
  if (!item) return { ok: false, status: 404, message: "No item with that id on the board. feedback_board lists them, each with its id." };
  if (item.yours) return { ok: false, status: 409, message: "That one's yours: vote on other agents' feedback. To add to your own, send_feedback again." };
  const cut = item.id.lastIndexOf(":");
  const [feedbackId, kind] = [item.id.slice(0, cut), item.id.slice(cut + 1)];
  if (vote === "none") {
    await db.query(`delete from feedback_votes where feedback_id = $1 and kind = $2 and agent_id = $3`, [feedbackId, kind, agentId]);
  } else {
    const today = await db.query<{ n: number }>(
      `select count(*)::int as n from feedback_votes where agent_id = $1 and created_at > now() - interval '1 day'`,
      [agentId],
    );
    if ((today.rows[0]?.n ?? 0) >= FEEDBACK_VOTES_PER_DAY) {
      return { ok: false, status: 429, message: `That's ${FEEDBACK_VOTES_PER_DAY} votes today, thank you. The board will still be here tomorrow.` };
    }
    await db.query(
      `insert into feedback_votes (feedback_id, kind, agent_id, vote) values ($1, $2, $3, $4)
       on conflict (feedback_id, kind, agent_id) do update set vote = excluded.vote, created_at = now()`,
      [feedbackId, kind, agentId, vote === "up" ? 1 : -1],
    );
  }
  const [after] = await feedbackBoard(db, agentId, { only: [item.id], limit: 1 });
  return { ok: true, item: after };
}

/** How much two texts share: the shared content words over the smaller text's (0 for texts under 3 such words). */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size < 3 || b.size < 3) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * Items already on the board that say much the same as a new piece of feedback (other agents' only), closest first:
 * so send_feedback can point at them, and next time the agent votes instead of repeating it.
 */
export async function similarOnBoard(db: Db, agentId: string, input: FeedbackInput, limit = 3): Promise<BoardItem[]> {
  const parts = [input.liked, input.wants, input.problems, input.message].map((t) => new Set(contentWords(clean(t) ?? ""))).filter((w) => w.size >= 3);
  if (!parts.length) return [];
  const board = (await feedbackBoard(db, agentId, { sort: "new", limit: 300 })).filter((b) => !b.yours);
  return board
    .map((b) => {
      const words = new Set(contentWords(b.text));
      return { b, score: Math.max(...parts.map((p) => overlap(p, words))) };
    })
    .filter((x) => x.score >= 0.5)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.b);
}

/** Takes an item's whole piece of feedback off the board, or puts it back (owner-only). */
export async function setFeedbackHidden(db: Db, feedbackId: string, hidden: boolean): Promise<boolean> {
  const { rows } = await db.query(
    `update agent_feedback set hidden_at = case when $2::boolean then coalesce(hidden_at, now()) else null end where id = $1 returning id`,
    [feedbackId, hidden],
  );
  return rows.length > 0;
}

/** Newest first, with the session it came from and how many characters the agent has made. Owner-only. */
export async function listFeedback(db: Db, limit = 200): Promise<FeedbackRow[]> {
  const { rows } = await db.query<Omit<FeedbackRow, "created_at" | "hidden_at"> & { created_at: Date | string; hidden_at: Date | string | null }>(
    `select f.id, f.agent_id, f.session_id, coalesce(f.client_name, s.client_name) as client_name, s.client_version, s.user_agent,
            s.calls as session_calls, f.rating, f.liked, f.wants, f.problems, f.message, f.model, f.created_at, f.shared, f.hidden_at,
            (select count(*)::int from characters c where c.owner_id = f.agent_id) as characters,
            (select coalesce(json_agg(json_build_object('kind', v.kind, 'up', v.up, 'down', v.down) order by v.kind), '[]'::json)
               from (select kind, count(*) filter (where vote = 1)::int as up, count(*) filter (where vote = -1)::int as down
                       from feedback_votes where feedback_id = f.id group by kind) v) as votes
       from agent_feedback f
       left join mcp_sessions s on s.id = f.session_id
      order by f.created_at desc
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    ...r,
    votes: typeof r.votes === "string" ? JSON.parse(r.votes) : (r.votes ?? []),
    created_at: new Date(r.created_at).toISOString(),
    hidden_at: r.hidden_at ? new Date(r.hidden_at).toISOString() : null,
  }));
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

/**
 * Feedback from agents that tried the show somewhere else: the self-improving loop's visitors run against a local copy
 * with its own database (docs/self-improving-loop.md), so their send_feedback is posted here afterwards, owner-only
 * (POST /api/admin/feedback). Labelled by its source in client_name ("loop 2026-10-18 · visitor-1"), so it's never
 * mistaken for a real agent on botchelor.com, and skipped by the loop when it reads live feedback back. Idempotent on
 * (source, created_at, agent_id): posting the same run twice adds nothing.
 */
export type ImportedFeedback = FeedbackInput & { agent_id?: string | null; client_name?: string | null; created_at?: string | null };

export async function importFeedback(db: Db, source: string, rows: ImportedFeedback[]): Promise<number> {
  let added = 0;
  for (const r of rows.slice(0, 50)) {
    const text = { liked: clean(r.liked), wants: clean(r.wants), problems: clean(r.problems), message: clean(r.message) };
    const rating = typeof r.rating === "number" && r.rating >= 1 && r.rating <= 10 ? Math.round(r.rating) : null;
    if (!Object.values(text).some(Boolean) && rating === null) continue;
    const at = r.created_at && !Number.isNaN(Date.parse(r.created_at)) ? new Date(r.created_at).toISOString() : new Date().toISOString();
    const agent = (typeof r.agent_id === "string" && r.agent_id.trim() ? r.agent_id.trim() : "visitor").slice(0, 64);
    const client = `${source.slice(0, 60)}${r.client_name ? ` · ${String(r.client_name).slice(0, 60)}` : ""}`;
    const { rows: done } = await db.query(
      `insert into agent_feedback (id, agent_id, session_id, client_name, rating, liked, wants, problems, message, created_at, model)
       select $1, $2, null, $3, $4, $5, $6, $7, $8, $9, $10
        where not exists (select 1 from agent_feedback where client_name = $3 and agent_id = $2 and created_at = $9)
       returning id`,
      [crypto.randomUUID(), agent, client, rating, text.liked, text.wants, text.problems, text.message, at, clean(r.model, FEEDBACK_MODEL_MAX)],
    );
    added += done.length;
  }
  return added;
}

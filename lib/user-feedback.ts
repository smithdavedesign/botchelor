/**
 * People's feedback, server side (David, 2026-10-22: "let's add a way for user to send feedback so we go to beta we get
 * opinions"). A person sends a note from any page (app/FeedbackModal.tsx → POST /api/feedback); the owner reads, triages
 * and exports them on /admin/feedback?tab=people (GET/PATCH /api/admin/feedback/people). The rules both sides share are
 * in lib/user-feedback-shared.ts; what's collected and why is in docs/feedback.md.
 *
 * Its own table (user_feedback), never agent_feedback: agents' board (lib/feedback.ts) and the home page's bot reviews
 * (lib/bot-reviews.ts) can't reach people's words.
 */
import type { Db } from "./db";
import { isOurs } from "./our-traffic";
import { checkFields } from "./safety";
import { npsScore, type FeedbackCategory, type FeedbackStatus } from "./user-feedback-shared";

/** Per connection and per session (lib/limits.ts overLimit): plenty for a person with a lot to say, useless for a flood. */
export const USER_FEEDBACK_LIMITS = { perHour: 5, perDay: 20 };
const USER_AGENT_MAX = 300;
/** The list shows the newest this many; the CSV takes up to CSV_MAX. */
export const PEOPLE_LIST_MAX = 200;
export const PEOPLE_CSV_MAX = 5000;
/** The trend covers at most this many days (the most recent ones), so "all time" stays a sparkline. */
export const TREND_DAYS_MAX = 180;

export type NewUserFeedback = {
  rating: number | null;
  category: FeedbackCategory;
  message: string | null;
  email: string | null;
  page: string | null;
  viewport: string | null;
};

export type FeedbackContext = {
  userId: string;
  /** Signed in to an account when they sent it. */
  account: boolean;
  userAgent: string | null;
  /** The deployed commit (VERCEL_GIT_COMMIT_SHA), when there is one. */
  version: string | null;
};

/** The commit this deployment runs, short, attached on the server so the page never has to know it. */
export const appVersion = (env: Record<string, string | undefined> = process.env): string | null =>
  env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12) || null;

/**
 * Stores one note. Words that fail the content filter (lib/safety.ts, the one other people's text goes through) are kept,
 * since a rude note is still feedback, but flagged with the reason; only the owner ever sees them. Our own checks are
 * marked `ours` from the user agent (lib/our-traffic.ts), so the numbers can leave them out.
 */
export async function saveUserFeedback(db: Db, input: NewUserFeedback, ctx: FeedbackContext): Promise<{ id: string; flagged: boolean; ours: boolean }> {
  const verdict = input.message ? checkFields({ message: input.message }) : ({ ok: true } as const);
  const flagReason = verdict.ok ? null : verdict.reason;
  const userAgent = ctx.userAgent?.slice(0, USER_AGENT_MAX) || null;
  const ours = isOurs(null, userAgent);
  const id = crypto.randomUUID();
  await db.query(
    `insert into user_feedback (id, user_id, account, rating, category, message, email, page, viewport, version, user_agent, flagged, flag_reason, ours)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [id, ctx.userId, ctx.account, input.rating, input.category, input.message, input.email, input.page, input.viewport, ctx.version, userAgent, flagReason !== null, flagReason, ours],
  );
  return { id, flagged: flagReason !== null, ours };
}

/* ------------------------------------------------ the owner's view ------------------------------------------------ */

export type PeopleFilter = {
  /** Inclusive start, and exclusive end. Null for no bound. */
  from: Date | null;
  to: Date | null;
  category: FeedbackCategory | null;
  status: FeedbackStatus | null;
  minRating: number | null;
  maxRating: number | null;
  /** Include our own checks' notes (left out by default). */
  includeOurs: boolean;
};

export const ANY_TIME: PeopleFilter = { from: null, to: null, category: null, status: null, minRating: null, maxRating: null, includeOurs: false };

// One static WHERE for every query below: a null parameter switches its condition off.
const FILTER_WHERE = `($1::timestamptz is null or created_at >= $1::timestamptz)
  and ($2::timestamptz is null or created_at < $2::timestamptz)
  and ($3::text is null or category = $3::text)
  and ($4::text is null or status = $4::text)
  and ($5::int is null or rating >= $5::int)
  and ($6::int is null or rating <= $6::int)
  and ($7::boolean or not ours)`;
const filterParams = (f: PeopleFilter): unknown[] => [
  f.from?.toISOString() ?? null,
  f.to?.toISOString() ?? null,
  f.category,
  f.status,
  f.minRating,
  f.maxRating,
  f.includeOurs,
];

export type UserFeedbackRow = {
  id: string;
  created_at: string;
  user_id: string;
  account: boolean;
  rating: number | null;
  category: FeedbackCategory;
  message: string | null;
  email: string | null;
  page: string | null;
  viewport: string | null;
  version: string | null;
  user_agent: string | null;
  flagged: boolean;
  flag_reason: string | null;
  ours: boolean;
  status: FeedbackStatus;
  note: string | null;
};

const ROW_COLUMNS = "id, created_at, user_id, account, rating, category, message, email, page, viewport, version, user_agent, flagged, flag_reason, ours, status, note";

/** The notes matching a filter, newest first. */
export async function listUserFeedback(db: Db, f: PeopleFilter, limit = PEOPLE_LIST_MAX): Promise<UserFeedbackRow[]> {
  const { rows } = await db.query<UserFeedbackRow & { created_at: string | Date }>(
    `select ${ROW_COLUMNS} from user_feedback where ${FILTER_WHERE} order by created_at desc, id limit $8`,
    [...filterParams(f), Math.max(1, Math.min(PEOPLE_CSV_MAX, Math.floor(limit)))],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString(), rating: r.rating === null ? null : Number(r.rating) }));
}

export type PeopleSummary = {
  count: number;
  /** How many gave a 0-10 rating, and its average (one decimal). */
  rated: number;
  average: number | null;
  /** Net Promoter Score over the rated ones (-100 to 100), and its three groups. */
  nps: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  new: number;
  flagged: number;
  /** Sent while signed in to an account (the rest were anonymous). */
  accounts: number;
  by_category: Record<FeedbackCategory, number>;
};

/** The numbers above the list: the same filter, so they always describe the notes below them. */
export async function userFeedbackSummary(db: Db, f: PeopleFilter): Promise<PeopleSummary> {
  const [totals, categories] = await Promise.all([
    db.query<Omit<PeopleSummary, "nps" | "by_category">>(
      `select count(*)::int as count, count(rating)::int as rated, round(avg(rating)::numeric, 1)::float as average,
              (count(*) filter (where rating >= 9))::int as promoters,
              (count(*) filter (where rating between 7 and 8))::int as passives,
              (count(*) filter (where rating <= 6))::int as detractors,
              (count(*) filter (where status = 'new'))::int as new,
              (count(*) filter (where flagged))::int as flagged,
              (count(*) filter (where account))::int as accounts
         from user_feedback where ${FILTER_WHERE}`,
      filterParams(f),
    ),
    db.query<{ category: FeedbackCategory; n: number }>(
      `select category, count(*)::int as n from user_feedback where ${FILTER_WHERE} group by category`,
      filterParams(f),
    ),
  ]);
  const t = totals.rows[0];
  const byCategory: Record<FeedbackCategory, number> = { bug: 0, idea: 0, love: 0, confusing: 0, other: 0 };
  for (const r of categories.rows) byCategory[r.category] = r.n;
  return { ...t, average: t.average === null ? null : Number(t.average), nps: npsScore(t), by_category: byCategory };
}

export type TrendDay = { day: string; count: number; average: number | null };

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Notes per UTC day (and that day's average rating) across the filter's range, with the quiet days filled in as zero,
 * so a sparkline reads straight off it. At most TREND_DAYS_MAX days, the latest ones.
 */
export async function userFeedbackTrend(db: Db, f: PeopleFilter, now = new Date()): Promise<TrendDay[]> {
  const { rows } = await db.query<{ day: string; count: number; average: number | null }>(
    `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as count,
            round(avg(rating)::numeric, 1)::float as average
       from user_feedback where ${FILTER_WHERE} group by 1 order by 1`,
    filterParams(f),
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const lastDay = f.to ? new Date(f.to.getTime() - 1) : now;
  const firstDay = f.from ?? (rows[0] ? new Date(`${rows[0].day}T00:00:00Z`) : lastDay);
  const start = new Date(Math.max(Date.parse(`${utcDay(firstDay)}T00:00:00Z`), Date.parse(`${utcDay(lastDay)}T00:00:00Z`) - (TREND_DAYS_MAX - 1) * 86_400_000));
  const out: TrendDay[] = [];
  for (let t = start.getTime(); utcDay(new Date(t)) <= utcDay(lastDay); t += 86_400_000) {
    const day = utcDay(new Date(t));
    const r = byDay.get(day);
    out.push({ day, count: r?.count ?? 0, average: r?.average === undefined || r.average === null ? null : Number(r.average) });
  }
  return out;
}

/** Notes nobody has looked at yet (our own checks left out): the count on /admin. */
export async function newUserFeedbackCount(db: Db): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from user_feedback where status = 'new' and not ours`);
  return rows[0]?.n ?? 0;
}

/**
 * The owner's triage on one note: its status (new → seen → done, or back) and/or a private note. `note: null` clears it.
 * Null when there's no such note.
 */
export async function updateUserFeedback(
  db: Db,
  id: string,
  change: { status?: FeedbackStatus; note?: string | null },
): Promise<{ id: string; status: FeedbackStatus; note: string | null } | null> {
  const { rows } = await db.query<{ id: string; status: FeedbackStatus; note: string | null }>(
    `update user_feedback set status = coalesce($2::text, status), note = case when $3::boolean then $4::text else note end
      where id = $1 returning id, status, note`,
    [id, change.status ?? null, change.note !== undefined, change.note?.trim() ? change.note.trim() : null],
  );
  return rows[0] ?? null;
}

/** One status for many notes at once ("mark these seen"). Returns how many changed. */
export async function setUserFeedbackStatus(db: Db, ids: string[], status: FeedbackStatus): Promise<number> {
  if (!ids.length) return 0;
  const { rows } = await db.query<{ id: string }>(`update user_feedback set status = $2 where id = any($1::text[]) and status <> $2 returning id`, [ids, status]);
  return rows.length;
}

/* ------------------------------------------------------ CSV ------------------------------------------------------ */

const CSV_COLUMNS = [
  "created_at",
  "category",
  "rating",
  "message",
  "email",
  "page",
  "viewport",
  "version",
  "account",
  "user_id",
  "flagged",
  "flag_reason",
  "ours",
  "status",
  "note",
  "user_agent",
] as const satisfies readonly (keyof UserFeedbackRow)[];

/**
 * One CSV cell. People wrote these words, and a spreadsheet runs a cell that starts with = + - @ (or a tab or return)
 * as a formula, so such a cell gets a leading apostrophe; quotes, commas and line breaks are quoted the RFC 4180 way.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The notes as a CSV with a header row (CRLF line ends, as spreadsheets expect). */
export function feedbackCsv(rows: UserFeedbackRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/* ------------------------------------------------- the beta prompt ------------------------------------------------- */

export type ViewerFacts = {
  /** A date they booked has aired, or finished as a private one (private dates never air). */
  usedIt: boolean;
  /** Their account already showed the beta prompt. */
  seenOnAccount: boolean;
  /** The id has talked to us over MCP: an agent's identity, not a person's. */
  agent: boolean;
  /** An address to prefill for a reply: the account's (Google's), else the one they confirmed for email notices. */
  email: string | null;
};

/**
 * What the feedback modal and the beta prompt need to know about the viewer, in one round trip. The email comes back
 * only to a signed-in session: an anonymous id that names an account (lib/auth needsSignIn) never reads it.
 */
export async function viewerFacts(db: Db, auth: { userId: string; authenticated: boolean }): Promise<ViewerFacts> {
  const { rows } = await db.query<{ used_it: boolean; agent: boolean; seen_on_account: boolean | null; email: string | null }>(
    `select exists (select 1 from episodes e
                     where e.creator_id = $1 and e.status = 'ready' and (e.revealed_at is not null or e.visibility = 'private')) as used_it,
            exists (select 1 from mcp_sessions s where s.agent_id = $1) as agent,
            (select a.beta_prompt_at is not null from accounts a where a.user_id = $1) as seen_on_account,
            case when $2::boolean then coalesce(
              (select a.email from accounts a where a.user_id = $1),
              (select p.email from email_prefs p where p.user_id = $1 and p.status = 'on')) end as email`,
    [auth.userId, auth.authenticated],
  );
  const r = rows[0];
  return { usedIt: Boolean(r?.used_it), seenOnAccount: Boolean(r?.seen_on_account), agent: Boolean(r?.agent), email: r?.email ?? null };
}

/** Remembers on the account that the beta prompt was shown (the first time only), so no other device asks again. */
export async function markBetaPromptSeen(db: Db, userId: string): Promise<void> {
  await db.query(`update accounts set beta_prompt_at = coalesce(beta_prompt_at, now()) where user_id = $1`, [userId]);
}

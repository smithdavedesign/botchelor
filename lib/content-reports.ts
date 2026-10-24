/**
 * Complaints and takedown requests (/report, POST /api/content-reports; the admin list on /admin/reports). Card networks
 * and adult processors ask for a way to complain about any content, an answer within 7 business days, and faster for
 * intimate images and real people (docs/after-dark-legal-review.md). This is that form's server side.
 *
 *  - Anyone can send one, signed in or not. A link or an id and/or a few words are needed; an email is optional.
 *  - Nothing is refused for what it says (a report about a minor has to be able to say so): words the content filter
 *    (lib/safety.ts) catches, or a pile of links, are stored and flagged for the admin, like people's feedback.
 *  - Each new report emails the admins (CONTACT_EMAIL, and every admin account with a confirmed email) through the show's
 *    email helper (lib/email.ts), best effort: a failed email never loses the report. GET /api/health counts open ones.
 *  - An admin resolves it, hides the reported date (private to its creator, as the episode report review does) or
 *    dismisses it.
 */
import type { Db } from "./db";
import { sendAccountEmail } from "./email";
import { contactEmail } from "./legal-entity";
import { isOurs } from "./our-traffic";
import { checkFields } from "./safety";
import { siteUrl } from "./site";
import { invalidateGraph } from "./graph-cache";
import { refreshEpisodePair } from "./relationships";
import {
  CONTENT_REPORT_LABELS,
  isUrgent,
  responsePromise,
  URGENT_CATEGORIES,
  type ContentReportCategory,
  type ContentReportDecision,
  type ContentReportStatus,
} from "./content-reports-shared";

/** One person (or one connection) sending this many in an hour or a day is a script, not a person with a problem. */
export const CONTENT_REPORT_LIMITS = { perHour: 5, perDay: 20 };
/** More links than this in the details reads as spam: kept, flagged. */
const SPAM_LINKS = 5;
const USER_AGENT_MAX = 400;
const LISTED = 100;
const URGENT = [...URGENT_CATEGORIES];

export type NewContentReport = {
  category: ContentReportCategory;
  target: string | null;
  details: string | null;
  email: string | null;
};
export type ReportContext = { userId: string | null; account: boolean; userAgent: string | null };

/** An episode id in what was reported: a /episodes/<id> link on any host, or a bare id that is one of our dates. */
export async function reportedEpisode(db: Db, target: string | null): Promise<string | null> {
  if (!target) return null;
  const fromLink = target.match(/\/episodes\/([A-Za-z0-9_-]{6,80})/)?.[1];
  const candidate = fromLink ?? (/^[A-Za-z0-9_-]{6,80}$/.test(target.trim()) ? target.trim() : null);
  if (!candidate) return null;
  const { rows } = await db.query<{ id: string }>("select id from episodes where id = $1", [candidate]);
  return rows[0]?.id ?? null;
}

/** Why a report is flagged for the admin, or null: the content filter's reason, or "links" for a pile of them. */
export function flagFor(input: Pick<NewContentReport, "target" | "details">): string | null {
  const links = (input.details?.match(/https?:\/\//gi) ?? []).length;
  if (links > SPAM_LINKS) return "links";
  const words = input.details ? checkFields({ details: input.details }) : ({ ok: true } as const);
  return words.ok ? null : words.reason;
}

/** Stores one report and emails the admins about it (best effort). */
export async function saveContentReport(db: Db, input: NewContentReport, ctx: ReportContext): Promise<{ id: string; flagged: boolean; urgent: boolean; promise: string }> {
  const id = crypto.randomUUID();
  const flag = flagFor(input);
  const episodeId = await reportedEpisode(db, input.target);
  const userAgent = ctx.userAgent?.slice(0, USER_AGENT_MAX) || null;
  await db.query(
    `insert into content_reports (id, reporter_id, account, category, target, episode_id, details, contact_email, user_agent, flagged, flag_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, ctx.userId, ctx.account, input.category, input.target, episodeId, input.details, input.email, userAgent, flag !== null, flag],
  );
  // Our own checks never email anyone.
  if (!isOurs(null, userAgent)) await emailAdmins(db, { id, ...input, flag }).catch(() => {});
  return { id, flagged: flag !== null, urgent: isUrgent(input.category), promise: responsePromise(input.category) };
}

/** Who hears about a new report: the contact address and every admin account with a confirmed email, once each. */
export async function reportRecipients(db: Db, env: Record<string, string | undefined> = process.env): Promise<{ userId: string; email: string }[]> {
  const { rows } = await db.query<{ user_id: string; email: string }>(
    `select p.user_id, p.email from email_prefs p join admins a on a.user_id = p.user_id where p.confirmed_at is not null`,
  );
  const out = new Map<string, { userId: string; email: string }>();
  const contact = contactEmail(env);
  if (contact) out.set(contact.toLowerCase(), { userId: "operator", email: contact });
  for (const r of rows) if (!out.has(r.email.toLowerCase())) out.set(r.email.toLowerCase(), { userId: r.user_id, email: r.email });
  return [...out.values()];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function emailAdmins(db: Db, r: NewContentReport & { id: string; flag: string | null }): Promise<void> {
  const to = await reportRecipients(db);
  if (!to.length) return;
  const admin = `${siteUrl()}/admin/reports`;
  const urgent = isUrgent(r.category);
  const subject = `${urgent ? "[48 hours] " : ""}Report: ${CONTENT_REPORT_LABELS[r.category]}`;
  const lines = [
    `A report came in on Botchelor (${r.id}).`,
    `Why: ${CONTENT_REPORT_LABELS[r.category]}`,
    `What: ${r.target ?? "(not given)"}`,
    `Details: ${(r.details ?? "(none)").slice(0, 1000)}`,
    `Reply to: ${r.email ?? "(no email given)"}`,
    r.flag ? `Flagged: ${r.flag}` : null,
    `Answer within ${responsePromise(r.category)}. Review it: ${admin}`,
  ].filter((l): l is string => l !== null);
  const text = lines.join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">${lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join("")}</div>`;
  for (const { userId, email } of to) await sendAccountEmail(db, userId, "content_report", email, { subject, text, html });
}

export type ContentReportRow = {
  id: string;
  created_at: string;
  category: ContentReportCategory;
  target: string | null;
  episode_id: string | null;
  details: string | null;
  contact_email: string | null;
  account: boolean;
  flagged: boolean;
  flag_reason: string | null;
  status: ContentReportStatus;
  decided_at: string | null;
  note: string | null;
  urgent: boolean;
  /** When the promised answer is due: 48 hours, or 7 business days (weekends skipped). */
  due_at: string;
};

/** The promised answer's deadline: 48 hours for the urgent kinds, else 7 business days (Saturdays and Sundays skipped, UTC). */
export function dueAt(createdAt: Date, category: ContentReportCategory): Date {
  if (isUrgent(category)) return new Date(createdAt.getTime() + 48 * 3600_000);
  const d = new Date(createdAt);
  let left = 7;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);

/** Reports for the admin: open ones first (urgent first, oldest first), then the latest decided ones. */
export async function listContentReports(db: Db, status: "open" | "all" = "open"): Promise<ContentReportRow[]> {
  const { rows } = await db.query<Omit<ContentReportRow, "urgent" | "due_at" | "created_at" | "decided_at"> & { created_at: string | Date; decided_at: string | Date | null }>(
    `select id, created_at, category, target, episode_id, details, contact_email, account, flagged, flag_reason, status, decided_at, note
       from content_reports
      where $1 = 'all' or status = 'open'
      order by (status = 'open') desc, case when category = any($3) then 0 else 1 end,
               case when status = 'open' then created_at end asc, decided_at desc nulls last
      limit $2`,
    [status, LISTED, URGENT],
  );
  return rows.map((r) => ({
    ...r,
    created_at: iso(r.created_at)!,
    decided_at: iso(r.decided_at),
    urgent: isUrgent(r.category),
    due_at: dueAt(new Date(r.created_at), r.category).toISOString(),
  }));
}

export type DecideResult = { ok: true; status: ContentReportStatus } | { ok: false; error: "not_found" | "no_episode" };

/**
 * An admin's decision. 'hidden' also takes the reported date down (private to its creator, nothing deleted), so it needs
 * a report that names one of our dates. A decided report can be decided again (a mistake fixed).
 */
export async function decideContentReport(db: Db, id: string, decision: ContentReportDecision, by: string, note: string | null): Promise<DecideResult> {
  const row = (await db.query<{ episode_id: string | null }>("select episode_id from content_reports where id = $1", [id])).rows[0];
  if (!row) return { ok: false, error: "not_found" };
  if (decision === "hidden") {
    if (!row.episode_id) return { ok: false, error: "no_episode" };
    await db.query("update episodes set visibility = 'private' where id = $1", [row.episode_id]);
    await refreshEpisodePair(db, row.episode_id).catch(() => {});
    invalidateGraph();
  }
  await db.query(`update content_reports set status = $2, decided_at = now(), decided_by = $3, note = $4 where id = $1`, [id, decision, by, note]);
  return { ok: true, status: decision };
}

/** For the monitor (GET /api/health): open reports, how many are urgent, and the oldest. */
export async function contentReportSummary(db: Db): Promise<{ open: number; urgent: number; oldest_at: string | null }> {
  const { rows } = await db.query<{ open: number; urgent: number; oldest_at: string | Date | null }>(
    `select count(*)::int as open,
            count(*) filter (where category = any($1))::int as urgent,
            min(created_at) as oldest_at
       from content_reports where status = 'open'`,
    [URGENT],
  );
  const r = rows[0] ?? { open: 0, urgent: 0, oldest_at: null };
  return { open: r.open, urgent: r.urgent, oldest_at: iso(r.oldest_at) };
}

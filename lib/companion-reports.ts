/**
 * Reported companion replies (docs/companions.md): a person reports one of a companion's replies in their own thread
 * (lib/companion.ts reportMessage), and the admin reviews it on /admin/reports with the few messages before it, nothing
 * more of the conversation. "fine" (nothing wrong) or "fix" (a real miss: the prompt or the checks need work). Open
 * reports are counted on GET /api/health, like the show's.
 */
import type { Db } from "./db";
import { COMPANION_REPORT_LABELS, type CompanionReportReason } from "./companion-shared";

export const COMPANION_REVIEW_DECISIONS = ["fine", "fix"] as const;
export type CompanionReviewDecision = (typeof COMPANION_REVIEW_DECISIONS)[number];

/** How many messages before a reported reply the review shows. */
export const REPORT_CONTEXT = 4;

export type CompanionReport = {
  message_id: string;
  character: { id: string; name: string };
  reason: string;
  reason_label: string;
  reported_at: string;
  text: string;
  /** In a scene: what the character did as they said it, and where. */
  action: string | null;
  scene: string | null;
  context: { role: "user" | "character" | "system"; text: string }[];
};

const iso = (v: string | Date | null): string | null => (v ? new Date(v).toISOString() : null);

/** The open reports, oldest first, each with the messages before it. */
export async function listCompanionReports(db: Db, limit = 50): Promise<CompanionReport[]> {
  const { rows } = await db.query<{
    id: string;
    thread_id: string;
    text: string;
    action: string | null;
    scene: string | null;
    reported: string;
    reported_at: string | Date;
    created_at: string | Date;
    character_id: string;
    name: string;
  }>(
    `select m.id, m.thread_id, m.text, m.action, m.scene, m.reported, m.reported_at, m.created_at, c.id as character_id, c.name
       from companion_messages m
       join companion_threads t on t.id = m.thread_id
       join characters c on c.id = t.character_id
      where m.reported is not null and m.report_reviewed_at is null
      order by m.reported_at asc
      limit $1`,
    [limit],
  );
  const out: CompanionReport[] = [];
  for (const r of rows) {
    const before = await db.query<{ role: "user" | "character" | "system"; text: string }>(
      `select role, text from companion_messages
        where thread_id = $1 and replaced_by is null and (created_at < $2 or (created_at = $2 and id < $3))
        order by created_at desc, id desc limit $4`,
      [r.thread_id, r.created_at, r.id, REPORT_CONTEXT],
    );
    out.push({
      message_id: r.id,
      character: { id: r.character_id, name: r.name },
      reason: r.reported,
      reason_label: COMPANION_REPORT_LABELS[r.reported as CompanionReportReason] ?? r.reported,
      reported_at: iso(r.reported_at)!,
      text: r.text,
      action: r.action,
      scene: r.scene,
      context: before.rows.reverse(),
    });
  }
  return out;
}

/** The admin's call on one; false when it isn't an open report. */
export async function reviewCompanionReport(db: Db, messageId: string, decision: CompanionReviewDecision, now: Date = new Date()): Promise<boolean> {
  const { rows } = await db.query(
    `update companion_messages set report_reviewed_at = $2, report_decision = $3 where id = $1 and reported is not null and report_reviewed_at is null returning id`,
    [messageId, now.toISOString(), decision],
  );
  return rows.length > 0;
}

/** For the system monitor (GET /api/health): how many wait, and since when. */
export async function companionReportSummary(db: Db): Promise<{ open: number; oldest_at: string | null }> {
  const { rows } = await db.query<{ open: number; oldest_at: string | Date | null }>(
    `select count(*)::int as open, min(reported_at) as oldest_at from companion_messages where reported is not null and report_reviewed_at is null`,
  );
  return { open: rows[0]?.open ?? 0, oldest_at: iso(rows[0]?.oldest_at ?? null) };
}

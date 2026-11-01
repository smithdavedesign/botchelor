import { getDb, pingDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { paidDatesPerDay, paidDatesToday } from "@/lib/limits";
import { serverErrorSummary } from "@/lib/errors";
import { openReportSummary } from "@/lib/moderation";
import { contentReportSummary } from "@/lib/content-reports";

export const dynamic = "force-dynamic";

/** A date still 'generating' after this long means the worker and its cron backstop both missed it. */
const STUCK_AFTER_MINUTES = 15;

/**
 * Liveness. Public callers, DigitalOcean's 10-second health check among them, get only {ok} and the database isn't
 * touched: a `select 1` every 10 seconds kept Neon from ever scaling to zero, so the database ran (and billed) around the
 * clock (2026-11-01). Restarting the app wouldn't fix an unreachable database anyway.
 * The system monitor (RepoHQ's collector, hourly) sends the cron secret (Authorization: Bearer $CRON_SECRET): it gets
 * 200 when the app can reach its database, 503 when it can't, and what needs the owner: episodes with open reports,
 * complaints and takedown requests waiting (/report), dates stuck generating, and today's paid-model dates against the
 * cap.
 */
export const GET = handle(async (req: Request) => {
  if (!internalJobAuthorized(req)) {
    // Opening the shared database also brings the schema up to date: start it on a new replica's first check without
    // making the check wait for it. After the first call it's cached and sends nothing.
    void getDb().catch(() => {});
    return json({ ok: true });
  }
  try {
    await pingDb();
  } catch {
    return json({ ok: false, db: "unreachable" }, 503);
  }
  const db = await getDb();
  const [reports, takedowns, stuck, paidToday, errors] = await Promise.all([
    openReportSummary(db),
    contentReportSummary(db),
    db.query<{ n: number }>(
      `select count(*)::int as n from episodes where status = 'generating' and created_at < now() - make_interval(mins => $1)`,
      [STUCK_AFTER_MINUTES],
    ),
    paidDatesToday(db),
    serverErrorSummary(db),
  ]);
  return json({
    ok: true,
    reports,
    content_reports: takedowns,
    stuck_generating: stuck.rows[0]?.n ?? 0,
    paid_dates: { today: paidToday, cap: paidDatesPerDay() },
    errors,
  });
});

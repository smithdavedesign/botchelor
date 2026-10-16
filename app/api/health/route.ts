import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { paidDatesPerDay, paidDatesToday } from "@/lib/limits";
import { openReportSummary } from "@/lib/moderation";

export const dynamic = "force-dynamic";

/** A date still 'generating' after this long means the worker and its cron backstop both missed it. */
const STUCK_AFTER_MINUTES = 15;

/**
 * Liveness for the system monitor (RepoHQ's collector, every 5 minutes): 200 when the app can reach its database,
 * 503 when it can't. With the cron secret (Authorization: Bearer $CRON_SECRET) it adds what needs the owner: episodes
 * with open reports, dates stuck generating, and today's paid-model dates against the cap. Public callers get only
 * {ok}.
 */
export const GET = handle(async (req: Request) => {
  let db;
  try {
    db = await getDb();
    await db.query("select 1");
  } catch {
    return json({ ok: false, db: "unreachable" }, 503);
  }
  if (!internalJobAuthorized(req)) return json({ ok: true });
  const [reports, stuck, paidToday] = await Promise.all([
    openReportSummary(db),
    db.query<{ n: number }>(
      `select count(*)::int as n from episodes where status = 'generating' and created_at < now() - make_interval(mins => $1)`,
      [STUCK_AFTER_MINUTES],
    ),
    paidDatesToday(db),
  ]);
  return json({
    ok: true,
    reports,
    stuck_generating: stuck.rows[0]?.n ?? 0,
    paid_dates: { today: paidToday, cap: paidDatesPerDay() },
  });
});

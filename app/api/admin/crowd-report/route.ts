import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { crowdActivity, welcomeReport } from "@/lib/welcome";

export const dynamic = "force-dynamic";

/**
 * Owner-only: how the house crowd is doing (docs/house-crowd.md). The welcome experiment per arm with its lift
 * (lib/welcome.ts), and what the crowd did and drew in the last ?days=N (default 7, at most 90). Counts only. The
 * weekly report on the Mac (scripts/crowd/weekly-report.mjs) reads this alongside its own prompt-test ledger.
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const raw = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const days = Number.isFinite(raw) ? Math.min(90, Math.max(1, Math.floor(raw))) : 7;
  const db = await getDb();
  const now = new Date();
  const [welcome, activity] = await Promise.all([welcomeReport(db, now), crowdActivity(db, new Date(now.getTime() - days * 86_400_000))]);
  return json({ generated_at: now.toISOString(), days, welcome, activity });
});

import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { referralReport } from "@/lib/crisis";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Admin: a calendar year's crisis referrals (lib/crisis.ts referralReport), for California SB 243's annual report to
 * the Office of Suicide Prevention (due from 2027-07-01, covering the year before). ?year=2026, default last year.
 */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const asked = Number(new URL(req.url).searchParams.get("year"));
  const year = Number.isInteger(asked) && asked >= 2025 && asked <= 2100 ? asked : new Date().getUTCFullYear() - 1;
  return json(await referralReport(await getDb(), year));
});

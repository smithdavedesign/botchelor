import { exportAccount } from "@/lib/account";
import { getDb } from "@/lib/db";
import { handle, json, userIdFromRequest } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Export everything stored under this account as JSON (PRD §6.1 data export). Owner-only (the cookie). */
export const GET = handle(async (req) => {
  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "no_account", message: "No account to export." }, 404);
  return json(await exportAccount(await getDb(), userId));
});

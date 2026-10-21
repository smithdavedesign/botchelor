import { exportAccount } from "@/lib/account";
import { needsSignIn } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Export everything stored under this account as JSON (PRD §6.1 data export). Owner-only (the cookie; an account needs its sign-in). */
export const GET = handle(async (req) => {
  const auth = authFromRequest(req);
  if (!auth) return json({ error: "no_account", message: "No account to export." }, 404);
  const db = await getDb();
  if (await needsSignIn(db, auth)) return json({ error: "sign_in_required", message: "This is an account: sign in to do that." }, 401);
  return json(await exportAccount(db, auth.userId));
});

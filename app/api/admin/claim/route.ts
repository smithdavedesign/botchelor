import { claimAdmin, isSignedInAdmin, releaseAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, session } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

/** Whether this browser's account is an admin (your own status only). An admin is a signed-in account. */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  return json({ admin: await isSignedInAdmin(await getDb(), sess), signed_in: Boolean(authFromRequest(req)?.authenticated) }, 200, sess);
});

/**
 * Make this browser's account an admin: needs the admin password (x-frontier-key, the same one the admin tools
 * use) and a signed-in account, since only a signed-in admin counts (lib/admins isSignedInAdmin). An admin skips the
 * clip paywall.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password." }, 403, sess);
  if (!sess.authenticated) return json({ error: "sign_in_required", message: "Sign in first: an admin is an account." }, 401, sess);
  await claimAdmin(await getDb(), sess.userId);
  return json({ admin: true }, 200, sess);
});

/** Stop being an admin on this account. */
export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  return json({ admin: false, removed: await releaseAdmin(await getDb(), sess.userId) }, 200, sess);
});

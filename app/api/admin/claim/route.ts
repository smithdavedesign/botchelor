import { claimAdmin, isAdmin, releaseAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, session } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

/** Whether this browser's account is an admin (your own status only). */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  return json({ admin: await isAdmin(await getDb(), sess.userId), signed_in: Boolean(authFromRequest(req)?.authenticated) }, 200, sess);
});

/**
 * Make this browser's account an admin: needs the admin password (x-frontier-key, the same one the admin tools
 * use). An admin skips the clip paywall. Sign in first so it follows you to every device.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password." }, 403, sess);
  await claimAdmin(await getDb(), sess.userId);
  return json({ admin: true }, 200, sess);
});

/** Stop being an admin on this account. */
export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  return json({ admin: false, removed: await releaseAdmin(await getDb(), sess.userId) }, 200, sess);
});

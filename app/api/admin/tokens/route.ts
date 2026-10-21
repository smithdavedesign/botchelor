import { ADMIN_TOKEN_GRANT, grantTokens, isSignedInAdmin } from "@/lib/admins";
import { episodeAllowance } from "@/lib/allowance";
import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";

/**
 * An admin tops up their own account with free dates (ADMIN_TOKEN_GRANT at a time), to test the show without buying.
 * Admin accounts only, signed in (claim it on /admin with the password first). Recorded as a grant, never an order.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  if (!(await isSignedInAdmin(db, sess))) return json({ error: "not_authorized", message: "Only an admin account, signed in, can do this." }, 403, sess);
  await grantTokens(db, sess.userId, ADMIN_TOKEN_GRANT, sess.userId);
  const allowance = await episodeAllowance(db, sess.userId);
  return json({ granted: ADMIN_TOKEN_GRANT, allowance }, 200, sess);
});

import { isAdmin, isSignedInAdmin } from "./admins";
import type { Db } from "./db";
import { getDb } from "./db";
import { authFromRequest } from "./http";
import { frontierAuthorized } from "./model";

/** The admin password (x-frontier-key, like the other admin tools) or a signed-in admin account (lib/admins.ts). */
export async function adminAuthorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}

export const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." } as const;

/**
 * Whose work an admin action is for: a signed-in admin's own, or (with the admin password) the admin named. Never
 * anyone else's (the password with someone's cookie doesn't act as them).
 */
export async function adminOwnerOf(db: Db, req: Request, named: string | undefined): Promise<string | null> {
  if (named) return frontierAuthorized(req) && (await isAdmin(db, named)) ? named : null;
  const me = authFromRequest(req);
  return me && (await isSignedInAdmin(db, me)) ? me.userId : null;
}

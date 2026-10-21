import { isSignedInAdmin } from "./admins";
import { getDb } from "./db";
import { authFromRequest } from "./http";
import { frontierAuthorized } from "./model";

/** The admin password (x-frontier-key, like the other admin tools) or a signed-in admin account (lib/admins.ts). */
export async function adminAuthorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}

export const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." } as const;

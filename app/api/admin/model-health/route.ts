import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { seasonKeyHealth, seasonKeysOn } from "@/lib/show-seasons";

export const dynamic = "force-dynamic";

/**
 * How whole the connected model's keys are (docs/data-model.md): the season registry, and how many aired dates carry
 * their season. Counts only, nothing about anyone. The admin password (x-frontier-key) or an admin account.
 */
export const GET = handle(async (req: Request) => {
  if (!frontierAuthorized(req) && !(await isSignedInAdmin(await getDb(), authFromRequest(req)))) {
    return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);
  }
  const db = await getDb();
  return json({ season_keys: { on: seasonKeysOn(), ...(await seasonKeyHealth(db)) } });
});

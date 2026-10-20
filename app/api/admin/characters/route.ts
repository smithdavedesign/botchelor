import { z } from "zod";
import { adminRemoveCharacters } from "@/lib/account";
import { isAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isAdmin(await getDb(), session(req).userId);
}

const Remove = z.object({ remove: z.array(z.string().min(1).max(64)).min(1).max(50) });

/**
 * Admin only: take characters off the show (lib/account.ts adminRemoveCharacters). Each is deleted, or kept only as the
 * sheet its episodes need when it's been on a date. Never a house character.
 */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);
  const input = parseBody(Remove, await readJson(req), "invalid_request");
  return json({ removed: await adminRemoveCharacters(await getDb(), [...new Set(input.remove)]) });
});

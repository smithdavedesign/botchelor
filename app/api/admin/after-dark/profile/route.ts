import { lockedForRequest } from "@/lib/adult/privacy";
import { deleteAdultProfile, exportAdultProfile } from "@/lib/adult/profile-data";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";

/**
 * The person's After Dark profile (lib/adult/profile-data.ts): GET downloads it as JSON, DELETE wipes it. Any signed-in
 * account, on an unlocked device (a PIN-locked one gets not found, like every After Dark route): the rights to take and
 * delete your data don't end with a subscription.
 */
async function owner(req: Request) {
  const db = await getDb();
  const auth = authFromRequest(req);
  if (!auth?.authenticated || (await lockedForRequest(db, auth.userId, req))) return { db, owner: null };
  return { db, owner: auth.userId };
}

export const GET = handle(async (req: Request) => {
  const { db, owner: who } = await owner(req);
  if (!who) return json({ error: "not_found" }, 404);
  const data = await exportAdultProfile(db, who);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="botchelor-after-dark-profile-${data.exported_at.slice(0, 10)}.json"`,
    },
  });
});

export const DELETE = handle(async (req: Request) => {
  const { db, owner: who } = await owner(req);
  if (!who) return json({ error: "not_found" }, 404);
  return json({ deleted: await deleteAdultProfile(db, who) });
});

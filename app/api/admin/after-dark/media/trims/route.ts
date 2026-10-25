import { isAdmin } from "@/lib/admins";
import { adultViewer } from "@/lib/adult/mode";
import { trimsFor } from "@/lib/adult/trim";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/** The trims of these videos (`?ids=a,b`; lib/adult/trim.ts), for a player of several: the viewer's own (an admin's, any). */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return json({ trims: await trimsFor(db, viewer, await isAdmin(db, viewer), ids) });
});

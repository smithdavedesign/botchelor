import { adultViewer } from "@/lib/adult/mode";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";

/**
 * Who they could shoot a remix with: their own characters (for an After Dark post, the ones in their After Dark, and only
 * when After Dark is open to them).
 */
export const GET = handle(async (req: Request) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "sign_in", message: "Sign in to shoot one like it." }, 401);
  const db = await getDb();
  const studio = new URL(req.url).searchParams.get("studio") === "after_dark" ? "after_dark" : "pg";
  if (studio === "after_dark") {
    const viewer = await adultViewer(db, req);
    if (!viewer) return json({ characters: [] });
    const { rows } = await db.query<{ id: string; name: string }>(
      `select c.id, c.name from adult_switches s join characters c on c.id = s.character_id where s.owner_id = $1 and c.owner_id = $1 order by c.name limit 50`,
      [viewer],
    );
    return json({ characters: rows });
  }
  const { rows } = await db.query<{ id: string; name: string }>(`select id, name from characters where owner_id = $1 order by name limit 50`, [auth.userId]);
  return json({ characters: rows });
});

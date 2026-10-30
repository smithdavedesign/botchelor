import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { momentPictures } from "@/lib/adult/scene-match";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The running chapter's moments being pictured (lib/adult/scene-match.ts momentPictures): `?a=&b=` answers
 * `{ moments: [{ id, line, status, picture_id, stand_in }] }`, light enough for the theater to ask every few seconds
 * while one is being drawn. Text-only places get no media.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const q = new URL(req.url).searchParams;
  return json({ moments: await momentPictures(db, viewer, q.get("a") ?? "", q.get("b") ?? "") });
});

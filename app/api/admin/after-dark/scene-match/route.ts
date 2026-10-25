import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { sceneMatch } from "@/lib/adult/scene-match";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * A picture the pair already has of what's happening in the scene now (lib/adult/scene-match.ts), for the theater to
 * offer instead of drawing: `?a=&b=`. Answers `{ match: { image_id, act } | null }`. Text-only places get no media.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const q = new URL(req.url).searchParams;
  const match = await sceneMatch(db, viewer, q.get("a") ?? "", q.get("b") ?? "");
  return json({ match });
});

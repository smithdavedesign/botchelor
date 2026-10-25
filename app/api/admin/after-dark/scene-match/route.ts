import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { sceneBackdrop, sceneMatch } from "@/lib/adult/scene-match";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * Media the pair already has of what's happening in the scene now (lib/adult/scene-match.ts): a picture for the theater
 * to offer instead of drawing (the exact-act 📷 chip), and the best fuzzy match (clip or still) to stand behind the
 * scene as an immersive backdrop. `?a=&b=`. Answers `{ match: { image_id, act } | null, backdrop: { kind, id } | null }`.
 * Text-only places get no media.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const q = new URL(req.url).searchParams;
  const a = q.get("a") ?? "";
  const b = q.get("b") ?? "";
  const [match, backdrop] = await Promise.all([sceneMatch(db, viewer, a, b), sceneBackdrop(db, viewer, a, b)]);
  return json({ match, backdrop });
});

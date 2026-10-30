import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { placeSound } from "@/lib/adult/place-sounds";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The sound of the stage's place (lib/adult/place-sounds.ts): `GET ?venue=<the stage's place>` gives it when it's ready,
 * says it's being made (started now if there's none), or that there's none. For After Dark's viewers only, and never
 * where media isn't offered.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const venue = (new URL(req.url).searchParams.get("venue") ?? "").slice(0, 300);
  return json(await placeSound(db, venue || null));
});

import { stepInViewer } from "@/lib/adult/step-in";
import { whoCard } from "@/lib/adult/step-in-who";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/**
 * The Who step's card for one character (lib/adult/step-in-who.ts): their bio, type and nights with the viewer, and the
 * carousel's pictures, After Dark's locked when the viewer's plan has none. `?id=<character>`; `&locked=1` from an
 * admin shows it as a free taste sees it. Not found for anyone Step in isn't open to, and for anyone After Dark may
 * not pair with them.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  const url = new URL(req.url);
  const details = await whoCard(db, viewer, url.searchParams.get("id") ?? "", { headers: req.headers, asTaste: url.searchParams.get("locked") === "1" });
  return details ? json(details) : json({ error: "not_found" }, 404);
});

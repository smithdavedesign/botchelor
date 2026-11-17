import { adultViewer } from "@/lib/adult/mode";
import { adultPickerDemand } from "@/lib/adult/tag-demand";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/**
 * How much each After Dark tag is wanted (lib/adult/tag-demand.ts): the blended numbers Set the scene and Step in
 * order their shelves by. Numbers only. Anyone After Dark is closed to gets the same 404 as everywhere else here.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await adultViewer(db, req))) return json({ error: "not_found" }, 404);
  return json({ demand: await adultPickerDemand(db) });
});

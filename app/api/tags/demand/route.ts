import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { pickerDemand } from "@/lib/tag-demand";

/**
 * How much each tag is wanted on Botchelor (lib/tag-demand.ts): the blended numbers the show's pickers order their
 * shelves and menus by (roleplay setups and themes, character types). Numbers only, nothing about anyone; computed at
 * most once an hour per server.
 */
export const GET = handle(async () => {
  const demand = await pickerDemand(await getDb());
  return json(demand);
});

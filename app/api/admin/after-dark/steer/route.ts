import { z } from "zod";
import { playableIds } from "@/lib/adult/characters";
import { adultViewer } from "@/lib/adult/mode";
import { resetSteering, steerSummary } from "@/lib/adult/steering";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ character_id: z.string().min(1).max(64), reset: z.literal(true) });

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * "Start fresh" on what your ratings of a character steer (lib/adult/steering.ts resetSteering): the ratings and light
 * picks from before now stop counting for them. Nothing is deleted. Returns what's left to steer by (nothing, yet).
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  // In their After Dark, or someone who left the cast that they keep a pair with (#1132).
  if (!(await playableIds(db, viewer)).has(input.character_id)) return hidden();
  await resetSteering(db, viewer, input.character_id);
  return json({ steer: (await steerSummary(db, viewer, [input.character_id]))[input.character_id] });
});

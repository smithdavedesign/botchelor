import { z } from "zod";
import { loadCharacter } from "@/lib/character";
import { eligibleIds } from "@/lib/adult/characters";
import { HivePausedError } from "@/lib/adult/hive-limit";
import { drawBaselineChoices } from "@/lib/adult/media";
import { adultViewer } from "@/lib/adult/mode";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// Three pictures, each drawn and checked in turn: 10 to 30 seconds apiece.
export const maxDuration = 300;

// `nude`: three nude ones, for the face of their undressed moments (lib/adult/attire.ts).
const Input = z.object({ character_id: z.string().min(1).max(64), nude: z.boolean().optional() });

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * Three waist-up pictures of one character to pick a face from, one in each light (lib/adult/media.ts
 * drawBaselineChoices). Each counts as one of this month's pictures; the one picked becomes the face their pictures and
 * videos keep (POST /api/admin/after-dark/face).
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (!(await eligibleIds(db, viewer)).has(input.character_id)) return hidden();
  const c = await loadCharacter(db, input.character_id);
  if (!c) return hidden();
  try {
    const r = await drawBaselineChoices(db, viewer, c, { nude: input.nude === true });
    if (!r.pictures.length) return json({ error: "not_made", message: `None of the three came through: ${r.failed[0] ?? "try again"}` }, 502);
    return json({ pictures: r.pictures, failed: r.failed.length });
  } catch (err) {
    if (err instanceof HivePausedError) return json({ error: "hive_paused", message: err.message }, 503);
    throw err;
  }
});

import { z } from "zod";
import { eligibleIds } from "@/lib/adult/characters";
import { adultViewer } from "@/lib/adult/mode";
import { setFaceReference } from "@/lib/adult/steering";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const id = z.string().min(1).max(64);
/**
 * The picture whose face to keep, or null to go back to the default (lib/adult/steering.ts faceReferenceId). `rivals`: the
 * other pictures it was picked from in "Draw three", which teaches the light test which lights were passed over.
 */
const Input = z.object({ character_id: id, image_id: id.nullable(), rivals: z.array(id).max(4).optional() });

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** "Use this face": the face your pictures and videos of this character keep from now on. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (!(await eligibleIds(db, viewer)).has(input.character_id)) return hidden();
  const r = await setFaceReference(db, viewer, input.character_id, input.image_id, input.rivals ?? []);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ image_id: r.image_id });
});

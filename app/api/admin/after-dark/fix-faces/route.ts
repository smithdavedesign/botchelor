import { z } from "zod";
import { fixFaces } from "@/lib/adult/fix-faces";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// Each face is one edit (a minute or so), one after the other, then the check.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
/** One of the owner's pictures with its faces fixed (lib/adult/fix-faces.ts): both shown, or only one of them (`who`). */
const Input = z.object({ media_id: id, who: id.nullable().optional() });

/** Not found for everyone but a viewer After Dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await fixFaces(db, viewer, input.media_id, { who: input.who ?? null }, requestBase(req));
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ picture: r.picture, original: r.original });
});

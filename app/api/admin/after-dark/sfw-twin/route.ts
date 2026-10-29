import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { sfwTwin } from "@/lib/adult/sfw-twin";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// One edit (a minute or so), then the PG check (and the output check when it stays in After Dark).
export const maxDuration = 300;

/** One of the owner's pictures made again safe for work (lib/adult/sfw-twin.ts). */
const Input = z.object({ media_id: z.string().min(1).max(64) });

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
  const r = await sfwTwin(db, viewer, input.media_id, requestBase(req));
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json(r);
});

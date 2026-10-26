import { z } from "zod";
import { adultCaptions } from "@/lib/adult/captions";
import { adultViewer } from "@/lib/adult/mode";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// One text call (After Dark's text model), and a retry when the first reply can't be used.
export const maxDuration = 60;

const Input = z.object({ media_id: z.string().min(1).max(64), fresh: z.boolean().optional() });

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** Captions in their character's voice for one of their pictures or clips (lib/adult/captions.ts); `fresh`: three more. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await adultCaptions(db, viewer, input.media_id, { fresh: input.fresh });
  return r.ok ? json({ captions: r.captions }) : json({ error: r.error, message: r.message }, r.status);
});

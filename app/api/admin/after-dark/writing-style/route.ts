import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { adultNarratedOpen } from "@/lib/adult/narrate-scene";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { WRITING_STYLES } from "@/lib/narration";
import { setStyle, storedStyles } from "@/lib/writing-style";

const Input = z.object({ style: z.enum(WRITING_STYLES) });

/**
 * Your writing style in After Dark (lib/writing-style.ts): how your nights are written. Narrated is open to admins, and
 * to everyone After Dark is open to once its "narrated" rollout switch says so (lib/adult/rollout.ts); until then a POST
 * of "narrated" is refused with 403. Anyone After Dark is closed to gets the same 404 as everywhere else here.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const open = input.style === "script" ? false : await adultNarratedOpen(db, viewer);
  if (!(await setStyle(db, viewer, "adult", input.style, { adultOpenToAll: open }))) {
    return json({ error: "not_open", message: "The narrated style isn't open yet." }, 403);
  }
  return json({ styles: await storedStyles(db, viewer) });
});

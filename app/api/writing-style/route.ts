import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { WRITING_STYLES } from "@/lib/narration";
import { setStyle, storedStyles, stylesOpen } from "@/lib/writing-style";

const Input = z.object({ side: z.literal("show").default("show"), style: z.enum(WRITING_STYLES) });

/**
 * Your writing style on the show (lib/writing-style.ts): your dates and your companion's scenes. GET it, POST it.
 * Narrated comes with the Companion Plan: anyone else may only be on the script (a POST of "narrated" is refused with
 * 403). After Dark's side has its own route (app/api/admin/after-dark/writing-style): the show never reads After Dark.
 */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  return json({ styles: await storedStyles(db, sess.userId), open: await stylesOpen(db, sess.userId, "show") }, 200, sess);
});

export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (!(await setStyle(db, sess.userId, "show", input.style))) {
    return json({ error: "not_open", message: "The narrated style comes with the Companion Plan.", plan: "/companion/plan" }, 403, sess);
  }
  return json({ styles: await storedStyles(db, sess.userId) }, 200, sess);
});

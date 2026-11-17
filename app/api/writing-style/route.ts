import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { WRITING_STYLES } from "@/lib/narration";
import { setStyle, storedStyles, STYLE_SIDES, stylesOpen } from "@/lib/writing-style";

const Input = z.object({ side: z.enum(STYLE_SIDES), style: z.enum(WRITING_STYLES) });

/**
 * Your writing style (lib/writing-style.ts): GET the one for each side, POST one side's. Narrated is admins only while
 * it's tested: anyone else may only be on the script (a POST of "narrated" is refused with 403).
 */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  return json({ styles: await storedStyles(db, sess.userId), open: await stylesOpen(db, sess.userId) }, 200, sess);
});

export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (!(await setStyle(db, sess.userId, input.side, input.style))) {
    return json({ error: "not_open", message: "The narrated style isn't open yet." }, 403, sess);
  }
  return json({ styles: await storedStyles(db, sess.userId) }, 200, sess);
});

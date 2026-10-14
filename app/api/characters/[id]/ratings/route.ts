import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { rateCharacter } from "@/lib/ratings";
import { RATING_CATEGORY_IDS } from "@/lib/rules";

const Input = z.object({ category: z.enum(RATING_CATEGORY_IDS) });

/**
 * Toggle the viewer's rating of a character in one category ("likable" / "surprising"). One vote per
 * viewer per character per category; you can't rate your own OC. Never touches the engine or predictions.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();

  const result = await rateCharacter(db, sess.userId, id, input.category);
  if (result === null) return json({ error: "character_not_found" }, 404, sess);
  if (result === "self") {
    return json({ error: "cannot_rate_own", message: "You can't rate your own character." }, 403, sess);
  }
  return json({ character_id: id, category: input.category, rated: result.rated, counts: result.counts }, 200, sess);
});

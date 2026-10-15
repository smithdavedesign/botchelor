import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { loadCharacterMemory, loadForgets } from "@/lib/memory";
import { ownsCharacter } from "@/lib/souls";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Everything your character has learned from its aired dates, with where each item came from (`sources`) and what
 * you've told it to forget. Owner only: it includes the character's private feelings about the people it dated.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const [memory, forgotten] = await Promise.all([loadCharacterMemory(db, id), loadForgets(db, id)]);
  return json({ character_id: id, memory, forgotten }, 200, sess);
});

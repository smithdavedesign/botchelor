import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { drawLooksPortrait } from "@/lib/looks-draw";
import { ownsCharacter } from "@/lib/souls";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 60;

/**
 * Draws your own character's portrait from the looks you picked for them (lib/looks.ts), on our image model, free.
 * Owner-only. Built only from the builder's fixed option words (nothing typed), screened by Hive before it's kept,
 * and capped per character and per day (lib/looks-draw.ts). It becomes their avatar everywhere.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const r = await drawLooksPortrait(db, id);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ asset_id: r.asset_id, portrait_path: `/api/assets/${r.asset_id}` }, 201, sess);
});

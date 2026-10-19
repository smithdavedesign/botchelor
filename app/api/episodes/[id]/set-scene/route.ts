import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { listSuggestions, SUGGESTION_MAX, suggestScene } from "@/lib/scene-suggestions";

type Ctx = { params: Promise<{ id: string }> };

const Input = z.object({ place: z.string().min(1).max(SUGGESTION_MAX) });

/**
 * Set the scene on a date while it's filmed (lib/scene-suggestions.ts): the creator only, 1 bought token, given back if
 * they don't go. The next line proposes it; the other one decides.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const { place } = parseBody(Input, await readJson(req), "invalid_request");
  const r = await suggestScene(await getDb(), sess.userId, id, place);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ suggestion: r.suggestion }, 200, sess);
});

/** What was suggested on this date and what happened, for its creator. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const mine = await db.query(
    `select 1 from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where e.id = $1 and $2::text in (e.creator_id, ca.owner_id, cb.owner_id)`,
    [id, sess.userId],
  );
  if (!mine.rows.length) return json({ error: "not_found" }, 404, sess);
  return json({ suggestions: await listSuggestions(db, id) }, 200, sess);
});

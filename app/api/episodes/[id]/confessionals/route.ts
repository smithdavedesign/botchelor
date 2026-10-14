import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

const Input = z.object({ shared: z.boolean() });

/**
 * The confessional (PRD): the host approves whether viewers can unlock the two private confessionals
 * once the finale has aired. Only the host of the date can toggle it.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();

  const { rows } = await db.query<{ confessionals_shared: boolean }>(
    `update episodes set confessionals_shared = $3
      where id = $1 and creator_id = $2
      returning confessionals_shared`,
    [id, sess.userId, input.shared],
  );
  if (!rows[0]) {
    const exists = (await db.query<{ n: number }>("select count(*)::int as n from episodes where id = $1", [id])).rows[0].n;
    if (!exists) return json({ error: "episode_not_found" }, 404, sess);
    return json({ error: "not_host", message: "Only the creator who asked for this date can share the confessionals." }, 403, sess);
  }
  return json({ id, confessionals_shared: rows[0].confessionals_shared }, 200, sess);
});

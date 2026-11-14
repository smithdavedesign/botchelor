import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * "Tell me when it's ready" on a date still being filmed (2026-11-14 feedback: "offer a notify option after ~2 min"):
 * its creator only. The job notifies them once it's filmed (lib/jobs.ts notifyIfAsked: the bell, and a push or email
 * where they turned those on). Asking again, or after it's filmed, is harmless.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const { rows } = await db.query<{ status: string }>(
    `update episodes set setup = coalesce(setup, '{}'::jsonb) || '{"notify_ready":true}'::jsonb
      where id = $1 and creator_id = $2 and status = 'generating'
      returning status`,
    [id, sess.userId],
  );
  if (rows.length) return json({ ok: true }, 200, sess);
  const mine = (await db.query<{ status: string }>(`select status from episodes where id = $1 and creator_id = $2`, [id, sess.userId])).rows[0];
  if (!mine) return json({ error: "not_found" }, 404, sess);
  return json({ ok: true, ready: mine.status !== "generating" }, 200, sess);
});

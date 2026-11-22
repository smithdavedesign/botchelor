import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { reportCounts, reportLimited, TOO_MANY_REPORTS } from "@/lib/report-trust";
import { reportMessage } from "@/lib/watch";

const Input = z.object({ message_id: z.string().min(1).max(64) });

/**
 * Reports a chat message. It is hidden once enough distinct viewers report it (REPORT_HIDE_THRESHOLD), counting only
 * the reports that count (lib/report-trust.ts). Limited per address and per identity.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  if (await reportLimited(db, req, sess.userId)) return json(TOO_MANY_REPORTS, 429, sess);
  const result = await reportMessage(db, id, input.message_id, sess.userId, { counts: reportCounts(req) });
  if (!result.ok) return json({ error: result.error }, result.status, sess);
  return json({ hidden: result.hidden }, 201, sess);
});

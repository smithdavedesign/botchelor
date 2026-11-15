import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { deleteMessage } from "@/lib/companion-message-delete";
import { companionRefusal } from "../../../access";

type Ctx = { params: Promise<{ id: string; messageId: string }> };

/**
 * Deletes one message of the person's own thread (lib/companion-message-delete.ts): theirs or the character's, a call's
 * words included; never the AI notice or a scene's line (409). The thread's own person only, a guest on their signed
 * session included, as for deleting the conversation. COMPANION_MESSAGE_DELETE=0: not-found, like an unknown message.
 */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id, messageId } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const r = await deleteMessage(db, sess.userId, id, messageId);
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  return json({ deleted: true, summary_reset: r.summary_reset }, 200, sess);
});

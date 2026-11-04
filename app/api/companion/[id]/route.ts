import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit } from "@/lib/limits";
import { inBackground } from "@/lib/sets";
import {
  carryOn,
  COMPANION_LIMITS,
  COMPANION_MESSAGE_MAX,
  COMPANION_REPORT_REASONS,
  companionFollowUp,
  deleteThread,
  editLast,
  getThread,
  regenerate,
  reportMessage,
  REPLY_LENGTHS,
  sendMessage,
  setReplyLength,
  type CompanionSend,
} from "@/lib/companion";
import { companionAllowance, giveBackReply, takeReply } from "@/lib/companion-plan";
import { companionRefusal } from "../access";

type Ctx = { params: Promise<{ id: string }> };

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), text: z.string().max(COMPANION_MESSAGE_MAX * 2) }),
  z.object({ action: z.literal("regenerate") }),
  z.object({ action: z.literal("edit"), text: z.string().max(COMPANION_MESSAGE_MAX * 2) }),
  z.object({ action: z.literal("length"), length: z.enum(REPLY_LENGTHS) }),
  z.object({ action: z.literal("carry_on") }),
  z.object({ action: z.literal("report"), message_id: z.string().min(1).max(64), reason: z.enum(COMPANION_REPORT_REASONS) }),
]);

type Allowance = Awaited<ReturnType<typeof companionAllowance>>;

const reply = (r: CompanionSend, sess: ReturnType<typeof session>, allowance: Allowance) => {
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json({ ...body, allowance }, status, sess);
  }
  return json({ view: r.view, allowance }, 200, sess);
};

/** The thread: its messages, its settings, how much the character remembers. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  return reply(await getThread(db, sess.userId, id), sess, await companionAllowance(db, sess.userId));
});

/**
 * One move in a thread: say something (send), draw the last reply again (regenerate), rewrite your last message (edit),
 * set how much the character says (length), carry on after the crisis resources (carry_on), or report a reply (report).
 * A reply is taken from the free count or the plan's fair use before it's drawn (lib/companion-plan.ts), and given back
 * when none came.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const input = parseBody(Action, await readJson(req), "invalid_request");
  const talks = input.action === "send" || input.action === "regenerate" || input.action === "edit";
  if (talks && (await overLimit(db, "companion", sess.userId, COMPANION_LIMITS))) {
    return json({ error: "rate_limited", message: "That's a lot of talking for now. Take a breather and come back in a bit." }, 429, sess);
  }
  const ticket = talks ? await takeReply(db, sess.userId) : null;
  if (ticket && !ticket.ok) return json({ error: ticket.error, message: ticket.message, allowance: ticket.allowance }, ticket.status, sess);
  let r: CompanionSend;
  switch (input.action) {
    case "send":
      r = await sendMessage(db, sess.userId, id, input.text);
      break;
    case "regenerate":
      r = await regenerate(db, sess.userId, id);
      break;
    case "edit":
      r = await editLast(db, sess.userId, id, input.text);
      break;
    case "length":
      r = await setReplyLength(db, sess.userId, id, input.length);
      break;
    case "carry_on":
      r = await carryOn(db, sess.userId, id);
      break;
    case "report":
      r = await reportMessage(db, sess.userId, id, input.message_id, input.reason);
      break;
  }
  if (ticket?.ok && !r.ok) await giveBackReply(db, sess.userId, ticket);
  if (talks && r.ok) inBackground(() => companionFollowUp(db, id));
  return reply(r, sess, await companionAllowance(db, sess.userId));
});

/** Deletes the thread, with everything the character remembered of it. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const r = await deleteThread(db, sess.userId, id);
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  return json({ deleted: true }, 200, sess);
});

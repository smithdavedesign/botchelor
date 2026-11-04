import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { getThread } from "@/lib/companion";
import { editFacts, FACT_MAX, listFacts } from "@/lib/companion-memory";
import { companionRefusal } from "../../access";

type Ctx = { params: Promise<{ id: string }> };

const Edit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("edit"), id: z.string().min(1).max(64), text: z.string().max(FACT_MAX * 2) }),
  z.object({ op: z.literal("add"), text: z.string().max(FACT_MAX * 2) }),
  z.object({ op: z.literal("pin"), id: z.string().min(1).max(64), pinned: z.boolean() }),
  z.object({ op: z.literal("delete"), id: z.string().min(1).max(64) }),
  z.object({ op: z.literal("forget_all") }),
]);

async function ownThreadOr404(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return { refused };
  const t = await getThread(db, sess.userId, id);
  if (!t.ok) return { refused: json({ error: t.error, message: t.message }, t.status, sess) };
  return { db, sess, id, view: t.view };
}

/** What the character knows about you (lib/companion-memory.ts): every fact, pinned first. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const o = await ownThreadOr404(req, ctx);
  if ("refused" in o) return o.refused!;
  return json({ character: o.view.character, facts: await listFacts(o.db, o.id) }, 200, o.sess);
});

/** One change to it: edit, add, pin, delete a fact, or forget everything (the summary too). */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const o = await ownThreadOr404(req, ctx);
  if ("refused" in o) return o.refused!;
  const input = parseBody(Edit, await readJson(req), "invalid_request");
  const problem = await editFacts(o.db, o.id, input);
  if (problem) return json({ error: "invalid_request", message: problem }, 400, o.sess);
  return json({ facts: await listFacts(o.db, o.id) }, 200, o.sess);
});

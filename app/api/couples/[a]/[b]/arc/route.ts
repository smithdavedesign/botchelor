import { z } from "zod";
import { arcQuestion, predictArc } from "@/lib/arcs";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

type Ctx = { params: Promise<{ a: string; b: string }> };

/** The couple's open arc question (lib/arcs.ts): "will they make it to date N?", the tally and your call. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const q = await arcQuestion(await getDb(), sess.userId, a, b);
  if (!q) return json({ error: "not_listed", message: "There's nothing to predict until their dates have aired." }, 404, sess);
  return json(q, 200, sess);
});

const Input = z.object({ pick: z.enum(["yes", "no"]) });

/** Make your call. Once per question; owners of either character can't. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const { pick } = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const r = await predictArc(db, sess.userId, a, b, pick === "yes");
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json(await arcQuestion(db, sess.userId, a, b), 201, sess);
});

import { z } from "zod";
import { track } from "@/lib/analytics";
import { audition, myAudition, withdrawAudition } from "@/lib/auditions";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { ownsCharacter } from "@/lib/souls";

type Ctx = { params: Promise<{ id: string }> };

// The button says what being cast means (lib/auditions.ts); the request carries that the owner agreed to it.
const Input = z.object({ consent: z.literal(true) });

/** The owner's audition panel for this character: its audition next month, or what stands in the way. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  return json(await myAudition(db, sess, id), 200, sess);
});

/** Put this character up for next month's cast. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  parseBody(Input, await readJson(req), "consent_required");
  const db = await getDb();
  const r = await audition(db, sess, id);
  if (!r.ok) return json({ error: r.error, message: r.message, blocks: r.blocks }, r.status, sess);
  track("audition", {});
  return json(await myAudition(db, sess, id), 201, sess);
});

/** Withdraw it: out of the auditions, its votes gone. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  await withdrawAudition(db, sess.userId, id);
  return json(await myAudition(db, sess, id), 200, sess);
});

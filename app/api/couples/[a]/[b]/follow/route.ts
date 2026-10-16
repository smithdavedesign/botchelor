import { getDb } from "@/lib/db";
import { followCouple, followState, unfollowCouple } from "@/lib/follows";
import { handle, json, session } from "@/lib/http";

type Ctx = { params: Promise<{ a: string; b: string }> };

/** Follow a couple (lib/follows.ts): hear when they go on another public date or move up a stage. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await followCouple(db, sess.userId, a, b))) {
    return json({ error: "not_listed", message: "You can follow a couple once one of their dates has aired." }, 404, sess);
  }
  return json(await followState(db, sess.userId, a, b), 200, sess);
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  await unfollowCouple(db, sess.userId, a, b);
  return json(await followState(db, sess.userId, a, b), 200, sess);
});

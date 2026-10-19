import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { REVIEW_MAX, reviewCharacter, reviewSummary } from "@/lib/reviews";

const Input = z.object({ stars: z.number().int().min(1).max(5), body: z.string().max(REVIEW_MAX).optional() });

/** A connection's reviews: enough to review a whole cast, not enough to flood one character from fresh cookies. */
const REVIEW_LIMITS = { perHour: 20, perDay: 60 };

/** A character's reviews: how many, the average, yours, and the latest few (lib/reviews.ts). */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  return json({ character_id: id, reviews: await reviewSummary(await getDb(), id, sess.userId) }, 200, sess);
});

/** Review a character, 1 to 5 stars and an optional line; reviewing again replaces yours. Never your own. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if (visitor && (await overLimit(db, "review", visitor, REVIEW_LIMITS))) {
    return json({ error: "too_many_reviews", message: "That's a lot of reviews from one connection. Try again within the hour." }, 429, sess);
  }
  const r = await reviewCharacter(db, sess.userId, id, input, "web");
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ character_id: id, reviews: r.summary }, 200, sess);
});

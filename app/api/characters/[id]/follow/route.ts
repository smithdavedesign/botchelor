import { CHARACTER_FOLLOW_LIMITS, followCharacter, unfollowCharacter } from "@/lib/character-follows";
import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { overLimit } from "@/lib/limits";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Follow a character (lib/character-follows.ts): hear when something public happens to them, and, where you may text
 * them, their texts are on for you. Anyone on a session, as following a couple is (someone without an account is
 * given a signed one here); never your own character, never a private one. 404 with CHARACTER_FOLLOW=0.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (await overLimit(db, "character_follow", sess.userId, CHARACTER_FOLLOW_LIMITS)) {
    return json({ error: "rate_limited", message: "That's a lot of follows for now. Come back in a bit." }, 429, sess);
  }
  const r = await followCharacter(db, sess, id);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ ...r.state, texts: r.texts, thread_id: r.thread_id }, 200, sess);
});

/** Unfollow: the notices stop and the texts the follow switched on go off again. The conversation stays. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const r = await unfollowCharacter(db, sess.userId, id);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ ...r.state, texts_off: r.texts_off }, 200, sess);
});

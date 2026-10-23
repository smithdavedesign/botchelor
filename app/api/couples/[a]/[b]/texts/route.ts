import { z } from "zod";
import { NUDGE_MAX } from "@/lib/between-dates";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { userTextModel } from "@/lib/keys";
import { pairKey } from "@/lib/relationships";
import { chainAfter, chainPage, loadChain } from "@/lib/text-chain";
import { writeOwnText } from "@/lib/texting";

type Ctx = { params: Promise<{ a: string; b: string }> };

/**
 * A couple's text chain (lib/text-chain.ts), a page at a time: the newest page, `?before=<cursor>` for the one before
 * it as the phone scrolls up, or `?after=<id>` for what's new since (the phone checks while it's open). The characters'
 * owners only, like the texts themselves.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const [lo, hi] = pairKey(a, b);
  const owner = (await db.query(`select 1 from characters where id = any($1) and owner_id = $2`, [[lo, hi], sess.userId])).rows.length > 0;
  if (!owner) {
    return json({ error: "owners_only", message: "Only the characters' owners can read their texts." }, 403, sess);
  }
  const params = new URL(req.url).searchParams;
  const items = await loadChain(db, lo, hi, { userId: sess.userId, owner: true });
  const after = params.get("after")?.slice(0, 200) || null;
  if (after) return json({ items: chainAfter(items, after), cursor: null, has_more: false }, 200, sess);
  return json(chainPage(items, params.get("before")?.slice(0, 200) || null), 200, sess);
});

const Input = z.object({ character_id: z.string().min(1).max(64), hint: z.string().max(NUDGE_MAX * 2).optional() });

/**
 * The owner's character texts the other, written on the owner's own model key (lib/texting.ts): as often and as long as
 * they like, since it's their model. A house character texts back on the same key. Without a key, the couple still gets
 * the show's daily text; this is for whenever they want more.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.character_id !== a && input.character_id !== b) {
    return json({ error: "not_in_couple", message: "That character isn't one of this couple." }, 422, sess);
  }
  const db = await getDb();
  const model = await userTextModel(db, sess.userId);
  if (!model) {
    return json(
      { error: "needs_own_key", message: "Connect your own model key for Dates & texts (Account → Connections), and your character can text whenever you like.", connect: "/account/keys#dates" },
      409,
      sess,
    );
  }
  const r = await writeOwnText(db, { userId: sess.userId, from: input.character_id, to: input.character_id === a ? b : a, model, hint: input.hint });
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ items: [r.sent, ...(r.reply ? [r.reply] : [])], ...(r.note ? { note: r.note } : {}) }, 200, sess);
});

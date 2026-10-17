import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { pairKey } from "@/lib/relationships";
import { chainPage, loadChain } from "@/lib/text-chain";

type Ctx = { params: Promise<{ a: string; b: string }> };

/**
 * A couple's text chain (lib/text-chain.ts), a page at a time: the newest page, or `?before=<cursor>` for the one
 * before it, as the phone scrolls up. The characters' owners only, like the texts themselves.
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
  const before = new URL(req.url).searchParams.get("before")?.slice(0, 200) || null;
  const items = await loadChain(db, lo, hi, { userId: sess.userId, owner: true });
  return json(chainPage(items, before), 200, sess);
});

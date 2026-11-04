import { z } from "zod";
import { signedInAdmin } from "@/lib/adult/mode";
import { lockedForRequest } from "@/lib/adult/privacy";
import { adTokenBalance, grantAdTokens } from "@/lib/adult/tokens";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ user_id: z.string().min(1).max(64), tokens: z.number().int().min(1).max(100) });

/**
 * An admin gives someone After Dark tokens (lib/adult/tokens.ts): a beta tester's video, a make-good after something
 * failed. Recorded as a grant by that admin, never an order. A signed-in admin on an unlocked device only; a 404 to
 * everyone else.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await signedInAdmin(db, authFromRequest(req));
  if (!admin || (await lockedForRequest(db, admin, req))) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const known = await db.query(`select 1 from accounts where user_id = $1`, [input.user_id]);
  if (!known.rows.length) return json({ error: "no_such_account", message: "No account has that id." }, 404);
  await grantAdTokens(db, input.user_id, input.tokens, admin);
  return json({ granted: input.tokens, balance: await adTokenBalance(db, input.user_id) });
});

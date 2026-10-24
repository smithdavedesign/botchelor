import { z } from "zod";
import { clearBillingFlag } from "@/lib/adult/billing";
import { signedInAdmin } from "@/lib/adult/mode";
import { lockedForRequest } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ user_id: z.string().min(1).max(64) });

/**
 * An admin has looked at an account a chargeback or refund flagged (lib/adult/billing.ts) and lets it subscribe again.
 * A signed-in admin on an unlocked device only; a 404 to everyone else.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await signedInAdmin(db, authFromRequest(req));
  if (!admin || (await lockedForRequest(db, admin, req))) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (!(await clearBillingFlag(db, input.user_id, admin))) return json({ error: "not_flagged", message: "That account has no open flag." }, 404);
  return json({ cleared: true });
});

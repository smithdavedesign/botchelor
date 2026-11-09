import { z } from "zod";
import { isAdmin } from "@/lib/admins";
import { billingFlagged, startTokenCheckout } from "@/lib/adult/billing";
import { canAfterDark } from "@/lib/adult/entitlement";
import { accessForUser } from "@/lib/adult/place";
import { adTokensOn } from "@/lib/adult/tokens";
import { afterDarkBase } from "@/lib/after-dark-host";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, isMcpCall, json, parseBody, readJson } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { requestPlace } from "@/lib/place";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Checkouts started, as for subscribing: a person trying twice or switching processor is a few; a script is many. */
const BUY_LIMITS = { perHour: 10, perDay: 30 };

const Input = z.object({
  tokens: z.number().int().positive(),
  processor: z.enum(["ccbill", "segpay", "verotel"]).optional(),
});

/**
 * Buys an After Dark token pack (lib/adult/tokens.ts): a one-time checkout link on the adult processor for someone After
 * Dark is open to, signed in. Not found until a processor can sell a pack. Refused for an agent or crawler, a place
 * where After Dark's pictures and videos aren't offered (451, the reason in words: tokens buy those), and an account a
 * chargeback or refund flagged until an admin looks. The tokens arrive with the processor's postback, not here.
 */
export const POST = handle(async (req: Request) => {
  if (!adTokensOn()) return json({ error: "not_found" }, 404);
  if (isMcpCall(req) || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) {
    return json({ error: "people_only", message: "Tokens are for people, in a browser." }, 403);
  }
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "needs_sign_in", message: "Sign in to your account to buy tokens." }, 401);
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if ((visitor !== null && (await overLimit(db, "ad_tokens_buy", visitor, BUY_LIMITS))) || (await overLimit(db, "ad_tokens_buy_user", auth.userId, BUY_LIMITS))) {
    return json({ error: "rate_limited", message: "Too many tries. Try again in an hour." }, 429);
  }
  if (!(await canAfterDark(db, auth)).ok) return json({ error: "not_found" }, 404);
  const access = await accessForUser(db, auth.userId, requestPlace(req.headers), await isAdmin(db, auth.userId));
  if (access.mode !== "open") {
    return json({ error: "not_available_here", message: access.reason ?? "After Dark's pictures and videos aren't offered where you're connecting from, so tokens aren't either." }, 451);
  }
  const input = parseBody(Input, await readJson(req), "pick_a_pack");
  if (await billingFlagged(db, auth.userId)) {
    return json({ error: "billing_review", message: "This account's last payment ended with a refund or a chargeback. Write to support and we'll look at it." }, 403);
  }
  const checkout = await startTokenCheckout(db, auth.userId, { tokens: input.tokens, processor: input.processor, base: afterDarkBase(requestBase(req)) });
  if (!checkout) return json({ error: "pack_unavailable", message: "That pack isn't sold that way. Pick another pack or way to pay." }, 422);
  return json({ url: checkout.url, processor: checkout.processor });
});

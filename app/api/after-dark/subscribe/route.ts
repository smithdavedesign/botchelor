import { z } from "zod";
import { isAdmin } from "@/lib/admins";
import { billingFlagged, billingOn, recordSelfDeclaration, startCheckout } from "@/lib/adult/billing";
import { canAfterDark } from "@/lib/adult/entitlement";
import { accessFor } from "@/lib/adult/place";
import { afterDarkBase } from "@/lib/after-dark-host";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, isMcpCall, json, parseBody, readJson } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { requestPlace } from "@/lib/place";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Checkouts started: a person trying twice or switching processor is a few; a script is many. */
const SUBSCRIBE_LIMITS = { perHour: 10, perDay: 30 };

// Both boxes on the subscribe page, ticked: the 18+ self-declaration, and the renewal terms (California's automatic
// renewal law wants express consent to them, separate from the rest).
const Input = z.object({
  adult: z.literal(true, "Confirm you're 18 or older."),
  renewal_terms: z.literal(true, "Confirm you understand it renews monthly until you cancel."),
  processor: z.enum(["ccbill", "segpay", "verotel"]).optional(),
});

/**
 * Starts an After Dark subscription (lib/adult/billing.ts): a signed-in person's checkout link on the processor, Segpay
 * first, Verotel if it's the only one set up (or asked for). Not found while no processor is configured. Refused for an
 * anonymous cookie, an agent or crawler, a place where After Dark isn't offered (451, the reason in words), an account
 * a chargeback or refund flagged until an admin looks, and someone already subscribed. On the way, the person's 18+
 * declaration is recorded (age_method 'self_declared', with the country they connect from), once.
 */
export const POST = handle(async (req: Request) => {
  if (!billingOn()) return json({ error: "not_found" }, 404);
  if (isMcpCall(req) || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) {
    return json({ error: "people_only", message: "Subscriptions are for people, in a browser." }, 403);
  }
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "needs_sign_in", message: "Sign in to your account to subscribe." }, 401);
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if ((visitor !== null && (await overLimit(db, "ad_subscribe", visitor, SUBSCRIBE_LIMITS))) || (await overLimit(db, "ad_subscribe_user", auth.userId, SUBSCRIBE_LIMITS))) {
    return json({ error: "rate_limited", message: "Too many tries. Try again in an hour." }, 429);
  }
  const admin = await isAdmin(db, auth.userId);
  const access = accessFor(requestPlace(req.headers), admin);
  if (access.mode === "blocked") return json({ error: "not_available_here", message: access.reason ?? "After Dark isn't offered where you're connecting from." }, 451);
  const input = parseBody(Input, await readJson(req), "confirmations_required");
  const entitled = await canAfterDark(db, auth);
  if (entitled.ok && entitled.why === "subscribed") return json({ error: "already_subscribed", message: "You're already subscribed." }, 409);
  if (await billingFlagged(db, auth.userId)) {
    return json({ error: "billing_review", message: "This account's last subscription ended with a refund or a chargeback. Write to support and we'll look at it." }, 403);
  }
  await recordSelfDeclaration(db, auth.userId, access.place.country);
  const checkout = await startCheckout(db, auth.userId, { processor: input.processor, base: afterDarkBase(requestBase(req)) });
  if (!checkout) return json({ error: "processor_unavailable", message: "That way to pay isn't available. Try the other one." }, 422);
  return json({ url: checkout.url, processor: checkout.processor });
});

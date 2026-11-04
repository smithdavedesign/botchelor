import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { PLAN_IDS, startPlanCheckout } from "@/lib/paid-plans";
import { passedAgeGate } from "../../step-in/access";

const CheckoutInput = z.object({
  plan: z.enum(PLAN_IDS, "Pick a plan."),
  attest: z.literal(true, "Confirm you are 18 or older."),
  // The auto-renewal terms, agreed to before paying (California's auto-renewal law): the price, monthly until cancelled.
  renews: z.literal(true, "Confirm you understand the plan renews automatically until you cancel."),
});

/**
 * Starts buying a plan (lib/paid-plans.ts): a random checkout id and the owner's Stripe Payment Link carrying it. No Stripe
 * API call, so nothing here can fail halfway; the plan starts only when the signed webhook (app/api/webhooks/stripe-plans)
 * says it was paid. Needs an account: a plan follows the person to any device, never a cookie.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(CheckoutInput, await readJson(req), "invalid_request");
  if (!sess.authenticated) {
    return json({ error: "account_required", message: "Sign in or create an account first, so your plan follows you to any device. Nothing was charged.", signin: "/account?next=%2Fcompanion%2Fplan" }, 401, sess);
  }
  if (!passedAgeGate(req)) return json({ error: "age_gate", message: "Botchelor is 18+. Confirm your age first." }, 403, sess);
  const url = await startPlanCheckout(await getDb(), sess.userId, input.plan);
  if (!url) return json({ error: "payments_unavailable", message: "The plan isn't on sale right now. Nothing was charged." }, 503, sess);
  return json({ url }, 200, sess);
});

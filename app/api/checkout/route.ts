import { z } from "zod";
import { sessionsSignable } from "@/lib/auth";
import { catalogItem, PACK_SKUS } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { createPendingOrder } from "@/lib/payments";
import { paymentLinkFromEnv, paymentLinkUrl } from "@/lib/stripe";

// Only the packs the Payment Links sell are accepted: the list price comes from the catalog, and no SKU sells points.
const CheckoutInput = z.object({
  sku: z.enum(PACK_SKUS, "Pick an item from the shop."),
  attest: z.literal(true, "Confirm you are 18 or older."),
});

/**
 * Starts buying an episode pack: a pending order, and the owner's Stripe Payment Link for that pack carrying the
 * order's random id. No Stripe API call is made, so nothing here can fail halfway. The pack is granted
 * only by the signed webhook (app/api/webhooks/stripe), never here. Packs stack, so there is no 409.
 *
 * Each pack has its own link (lib/stripe.ts paymentLinkFromEnv): a pack whose link isn't set answers 503 for that
 * pack alone, and the shop doesn't show its tile (lib/catalog.ts onSale).
 *
 * Buying needs an account (where the deployment has accounts): bought tokens hang off the buyer's id, and an
 * anonymous id is a cookie, so a new browser or cleared cookies would lose what they paid for. Signing up adopts
 * the anonymous id (lib/auth), so nothing a player already has is lost by being asked.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(CheckoutInput, await readJson(req), "invalid_request");
  const item = catalogItem(input.sku)!;

  const link = paymentLinkFromEnv(process.env, item.sku);
  if (!link) {
    return json(
      { error: "payments_unavailable", message: `"${item.name}" isn't on sale yet. Nothing was charged.` },
      503,
      sess,
    );
  }

  if (sessionsSignable() && !sess.authenticated) {
    return json(
      {
        error: "account_required",
        message: "Sign in or create an account to buy, so your tokens follow you to any device. Nothing was charged.",
        signin: "/account?next=%2Fshop",
      },
      401,
      sess,
    );
  }

  const orderId = await createPendingOrder(await getDb(), sess.userId, item);
  return json({ url: paymentLinkUrl(link, orderId) }, 200, sess);
});

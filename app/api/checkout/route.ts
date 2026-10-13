import { z } from "zod";
import { catalogItem, isRepeatable, SKUS } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { attachCheckoutSession, createPendingOrder, deletePendingOrder, ownsSku } from "@/lib/payments";
import { getPayments, PaymentError, type CheckoutSession } from "@/lib/stripe";

// Only a catalog SKU is accepted: the price comes from the catalog, and no SKU sells points.
const CheckoutInput = z.object({
  sku: z.enum(SKUS, "Pick an item from the shop."),
  attest: z.literal(true, "Confirm you are 18 or older."),
});

/**
 * Where Stripe sends the buyer back: the site their browser is on. Browsers send Origin on every POST,
 * and off Vercel Next builds req.url from the server's own host:port rather than the public one. A
 * forged Origin only redirects its sender, and cross-site JSON posts are stopped by CORS preflight.
 */
function siteOrigin(req: Request): string {
  const header = req.headers.get("origin");
  if (header) {
    try {
      const url = new URL(header);
      if ((url.protocol === "https:" || url.protocol === "http:") && url.origin === header) return url.origin;
    } catch {
      // Not a URL ("null", garbage): fall through.
    }
  }
  return new URL(req.url).origin;
}

/**
 * Starts a Stripe Checkout for one premium house character, frame or episode pack. Returns the
 * Stripe-hosted URL; the item is granted only by the signed webhook (app/api/webhooks/stripe), never here.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(CheckoutInput, await readJson(req), "invalid_request");
  const item = catalogItem(input.sku)!;

  const payments = getPayments();
  if (!payments) {
    return json(
      { error: "payments_unavailable", message: "Purchases aren't open yet. Nothing was charged." },
      503,
      sess,
    );
  }

  const db = await getDb();
  // Episode packs stack, so they can be bought again; everything else is owned once.
  if (!isRepeatable(item.kind) && (await ownsSku(db, sess.userId, item.sku))) {
    return json({ error: "already_owned", message: `You already own ${item.name}.` }, 409, sess);
  }

  const orderId = await createPendingOrder(db, sess.userId, item);
  const origin = siteOrigin(req);
  let checkout: CheckoutSession;
  try {
    checkout = await payments.createCheckoutSession({
      orderId,
      item,
      successUrl: `${origin}/shop?checkout=success`,
      cancelUrl: `${origin}/shop?checkout=cancelled`,
    });
  } catch (err) {
    await deletePendingOrder(db, orderId);
    if (!(err instanceof PaymentError)) throw err;
    console.warn("[checkout] stripe failed:", err.message);
    return json(
      { error: "checkout_unavailable", message: "Checkout is unavailable right now. Nothing was charged; try again soon." },
      502,
      sess,
    );
  }
  await attachCheckoutSession(db, orderId, checkout.id);
  return json({ url: checkout.url }, 200, sess);
});

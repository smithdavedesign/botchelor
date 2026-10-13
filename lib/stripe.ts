/**
 * The only code that talks to Stripe: Checkout Sessions over the REST API with plain fetch (no SDK,
 * like lib/model.ts), and webhook signature verification with node:crypto.
 *
 * STRIPE_SECRET_KEY switches purchases on (test-mode keys until there is a commercial-use host; see
 * BUILD.md). Without it, getPayments() is null and checkout fails closed with 503.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { CURRENCY, type CatalogItem } from "./catalog";

export const STRIPE_CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions";
/** Stripe's own libraries default to 5 minutes between the signed timestamp and now. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
export const STRIPE_TIMEOUT_MS = 10_000;

export class PaymentError extends Error {
  override name = "PaymentError";
}

export type CheckoutRequest = { orderId: string; item: CatalogItem; successUrl: string; cancelUrl: string };
export type CheckoutSession = { id: string; url: string };

export interface PaymentProvider {
  createCheckoutSession(req: CheckoutRequest): Promise<CheckoutSession>;
}

/**
 * One Checkout Session per order: a single line item priced from our catalog (price_data, so no
 * products need setting up in Stripe), keyed by our order id, never by the user's session cookie.
 */
export function stripeCheckout(opts: { secretKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): PaymentProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async createCheckoutSession(req) {
      const form = new URLSearchParams({
        mode: "payment",
        client_reference_id: req.orderId,
        "metadata[order_id]": req.orderId,
        "metadata[sku]": req.item.sku,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": CURRENCY,
        "line_items[0][price_data][unit_amount]": String(req.item.price_cents),
        "line_items[0][price_data][product_data][name]": req.item.name,
        "line_items[0][price_data][product_data][description]": req.item.description,
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
      });
      let res: Response;
      try {
        res = await doFetch(STRIPE_CHECKOUT_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${opts.secretKey}`,
            "content-type": "application/x-www-form-urlencoded",
            // A retried request for the same order gets the same session instead of a second one.
            "idempotency-key": req.orderId,
          },
          body: form.toString(),
          signal: AbortSignal.timeout(opts.timeoutMs ?? STRIPE_TIMEOUT_MS),
        });
      } catch (err) {
        throw new PaymentError(`stripe request failed (${err instanceof Error ? err.name : "unknown"})`);
      }
      if (!res.ok) throw new PaymentError(`stripe returned HTTP ${res.status}`);
      const data = (await res.json().catch(() => null)) as { id?: unknown; url?: unknown } | null;
      if (typeof data?.id !== "string" || typeof data.url !== "string" || !data.url.startsWith("https://")) {
        throw new PaymentError("stripe returned no checkout url");
      }
      return { id: data.id, url: data.url };
    },
  };
}

export function paymentsFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): PaymentProvider | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  return secretKey ? stripeCheckout({ secretKey, fetchImpl }) : null;
}

let testPayments: PaymentProvider | null = null;

/** Tests swap in a fake Stripe; production reads the environment on each call. */
export function setPaymentsForTests(payments: PaymentProvider | null): void {
  testPayments = payments;
}

export function getPayments(): PaymentProvider | null {
  return testPayments ?? paymentsFromEnv();
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * Stripe-Signature check, as Stripe documents it: v1 = hex HMAC-SHA256(secret, `${t}.${rawBody}`),
 * any v1 may match (several are sent while a secret rotates), v0 is ignored, compared in constant
 * time, and `t` must be within the tolerance of now on either side (replays fail).
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
): boolean {
  if (!header || !secret) return false;
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && timestamp === null) timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (timestamp === null || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest();
  return signatures.some((sig) => HEX_SHA256.test(sig) && timingSafeEqual(expected, Buffer.from(sig, "hex")));
}

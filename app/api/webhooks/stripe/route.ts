import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { grantOrder } from "@/lib/payments";
import { verifyStripeSignature } from "@/lib/stripe";

/** Checkout Session events are a few KB; anything this big isn't one. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

/** The two events that mean "paid". Card payments arrive paid on completion; async methods later. */
const GRANTING_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

const StripeEvent = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const CheckoutSessionObject = z.object({
  id: z.string(),
  object: z.literal("checkout.session"),
  client_reference_id: z.string().nullish(),
  payment_link: z.string().nullish(),
  payment_status: z.string(),
  amount_total: z.number().int().nullish(),
  currency: z.string().nullish(),
});

const invalidPayload = () => json({ error: "invalid_payload" }, 400);

/**
 * Stripe's webhook: how a payment on the owner's Payment Link becomes a pack. The signature is checked
 * over the raw text before anything is parsed; a bad one is a 400 that grants nothing. Every verified
 * event gets a 200 (unless malformed), so Stripe stops retrying; each Stripe session is granted at most
 * once (grantOrder). A payment we can't match is logged with its session id, for a grant by hand.
 */
export const POST = handle(async (req) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set; refusing the event so Stripe retries later");
    return json({ error: "webhook_not_configured" }, 500);
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES) return json({ error: "body_too_large" }, 413);
  const payload = await req.text();
  if (Buffer.byteLength(payload, "utf8") > MAX_WEBHOOK_BYTES) return json({ error: "body_too_large" }, 413);

  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) {
    return json({ error: "invalid_signature" }, 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return invalidPayload();
  }
  const event = StripeEvent.safeParse(parsed);
  if (!event.success) return invalidPayload();

  if (GRANTING_EVENTS.has(event.data.type)) {
    const checkout = CheckoutSessionObject.safeParse(event.data.data.object);
    if (!checkout.success) return invalidPayload();
    if (checkout.data.payment_status === "paid") {
      const outcome = await grantOrder(await getDb(), {
        orderId: checkout.data.client_reference_id ?? null,
        sessionId: checkout.data.id,
        paymentLink: checkout.data.payment_link ?? null,
        amountTotal: checkout.data.amount_total ?? null,
        currency: checkout.data.currency ?? null,
      });
      if (outcome === "unknown_order" || outcome === "mismatch") {
        console.warn(`[stripe] ${event.data.type} not granted (${outcome}) for session ${checkout.data.id}`);
      }
    }
  }
  return json({ received: true });
});

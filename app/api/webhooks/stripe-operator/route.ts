import { z } from "zod";
import { recordAgentEvent } from "@/lib/agent-funnel";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { agentForSubscription, grantOperatorPass, operatorPassOn } from "@/lib/operator-pass";
import {
  invoicePeriodEnd,
  invoiceSubscription,
  subscriptionEnding,
  subscriptionPeriodEnd,
  testEventsGrant,
  verifyStripeSignature,
} from "@/lib/stripe";

/** Subscription events are a few KB; anything this big isn't one. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

const StripeEvent = z.object({
  id: z.string(),
  type: z.string(),
  livemode: z.boolean().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const CheckoutSession = z.object({
  id: z.string(),
  mode: z.string().nullish(),
  payment_status: z.string().nullish(),
  client_reference_id: z.string().nullish(),
  subscription: z.string().nullish(),
});

const invalidPayload = () => json({ error: "invalid_payload" }, 400);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * The operator pass's Stripe subscription webhook (docs/PRDs/agent-world.md, Phase 0). Separate from the token-pack
 * webhook (app/api/webhooks/stripe/route.ts) and its own secret (OPERATOR_PASS_WEBHOOK_SECRET). It 404s until the pass
 * is switched on (lib/operator-pass operatorPassOn), so it doesn't exist until the owner provisions it. The signature
 * is checked over the raw text; each Stripe event is applied once (operator_pass_events). A subscription-mode checkout
 * grants the first month; invoice.paid renews to the period it paid for; a subscription cancel/delete ends it. Renewals
 * and cancels are read through lib/stripe.ts, since the endpoint gets the account's API version and the invoice's
 * subscription and the period's end moved in 2025-03-31.
 */
export const POST = handle(async (req) => {
  if (!operatorPassOn()) return json({ error: "not_found" }, 404);
  const secret = process.env.OPERATOR_PASS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[operator-pass] OPERATOR_PASS_WEBHOOK_SECRET is not set; refusing the event so Stripe retries later");
    return json({ error: "webhook_not_configured" }, 500);
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES) return json({ error: "body_too_large" }, 413);
  const payload = await req.text();
  if (Buffer.byteLength(payload, "utf8") > MAX_WEBHOOK_BYTES) return json({ error: "body_too_large" }, 413);
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) return json({ error: "invalid_signature" }, 400);

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return invalidPayload();
  }
  const event = StripeEvent.safeParse(parsed);
  if (!event.success) return invalidPayload();
  if (event.data.livemode === false && !testEventsGrant()) {
    console.warn(`[operator-pass] test-mode ${event.data.type} ignored on production (event ${event.data.id})`);
    return json({ received: true });
  }

  const db = await getDb();
  // Apply each Stripe event once: the event id is unique, so a retry inserts nothing and stops here.
  const fresh = await db.query(
    `insert into operator_pass_events (id, event_id, type, outcome, received_at) values ($1, $2, $3, 'received', now())
     on conflict (event_id) do nothing returning id`,
    [`ope_${event.data.id}`.slice(0, 80), event.data.id, event.data.type.slice(0, 80)],
  );
  if (!fresh.rows.length) return json({ received: true });

  const obj = event.data.data.object;
  let agentId: string | null = null;
  let subId: string | null = null;
  let outcome = "ignored";

  if (event.data.type === "checkout.session.completed") {
    const s = CheckoutSession.safeParse(obj);
    if (s.success && s.data.mode === "subscription" && s.data.payment_status === "paid" && s.data.client_reference_id) {
      agentId = s.data.client_reference_id;
      subId = s.data.subscription ?? null;
      await grantOperatorPass(db, agentId, "initial", { provider: "stripe", subscriptionId: subId });
      await recordAgentEvent(db, agentId, "pass_purchased", { provider: "stripe" }).catch(() => {});
      track("purchase_completed", { product: "operator_pass" });
      outcome = "initial";
    }
  } else if (event.data.type === "invoice.paid") {
    const invoiceSub = invoiceSubscription(obj);
    if (invoiceSub && obj.billing_reason === "subscription_cycle") {
      subId = invoiceSub;
      agentId = await agentForSubscription(db, subId);
      if (agentId) {
        await grantOperatorPass(db, agentId, "rebill", { provider: "stripe", subscriptionId: subId, periodEnd: invoicePeriodEnd(obj) });
        outcome = "rebill";
      }
    }
  } else if (event.data.type === "customer.subscription.updated") {
    const id = str(obj.id);
    if (id && subscriptionEnding(obj)) {
      subId = id;
      agentId = await agentForSubscription(db, id);
      if (agentId) {
        await grantOperatorPass(db, agentId, "cancel", { periodEnd: subscriptionPeriodEnd(obj), subscriptionId: subId });
        outcome = "cancel";
      }
    }
  } else if (event.data.type === "customer.subscription.deleted") {
    const id = str(obj.id);
    if (id) {
      subId = id;
      agentId = await agentForSubscription(db, id);
      if (agentId) {
        await grantOperatorPass(db, agentId, "expiry", { subscriptionId: subId });
        outcome = "expiry";
      }
    }
  }

  await db.query(`update operator_pass_events set user_id = $2, stripe_subscription_id = $3, outcome = $4 where event_id = $1`, [event.data.id, agentId, subId, outcome]);
  return json({ received: true });
});

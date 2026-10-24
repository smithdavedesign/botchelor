import { z } from "zod";
import { recordAgentEvent } from "@/lib/agent-funnel";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { agentForSubscription, grantOperatorPass, operatorPassOn } from "@/lib/operator-pass";
import { testEventsGrant, verifyStripeSignature } from "@/lib/stripe";

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
const Invoice = z.object({ id: z.string(), subscription: z.string().nullish(), billing_reason: z.string().nullish() });
const Subscription = z.object({ id: z.string(), cancel_at_period_end: z.boolean().nullish(), current_period_end: z.number().int().nullish() });

const invalidPayload = () => json({ error: "invalid_payload" }, 400);
const toDate = (unixSeconds: number | null | undefined): Date | null => (typeof unixSeconds === "number" ? new Date(unixSeconds * 1000) : null);

/**
 * The operator pass's Stripe subscription webhook (docs/PRDs/agent-world.md, Phase 0). Separate from the token-pack
 * webhook (app/api/webhooks/stripe/route.ts) and its own secret (OPERATOR_PASS_WEBHOOK_SECRET). It 404s until the pass
 * is switched on (lib/operator-pass operatorPassOn), so it doesn't exist until the owner provisions it. The signature
 * is checked over the raw text; each Stripe event is applied once (operator_pass_events). A subscription-mode checkout
 * grants the first month; invoice.paid renews; a subscription cancel/delete ends it.
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
    const inv = Invoice.safeParse(obj);
    if (inv.success && inv.data.subscription && inv.data.billing_reason === "subscription_cycle") {
      subId = inv.data.subscription;
      agentId = await agentForSubscription(db, subId);
      if (agentId) {
        await grantOperatorPass(db, agentId, "rebill", { provider: "stripe", subscriptionId: subId });
        outcome = "rebill";
      }
    }
  } else if (event.data.type === "customer.subscription.updated") {
    const sub = Subscription.safeParse(obj);
    if (sub.success && sub.data.cancel_at_period_end) {
      subId = sub.data.id;
      agentId = await agentForSubscription(db, subId);
      if (agentId) {
        await grantOperatorPass(db, agentId, "cancel", { periodEnd: toDate(sub.data.current_period_end), subscriptionId: subId });
        outcome = "cancel";
      }
    }
  } else if (event.data.type === "customer.subscription.deleted") {
    const sub = Subscription.safeParse(obj);
    if (sub.success) {
      subId = sub.data.id;
      agentId = await agentForSubscription(db, subId);
      if (agentId) {
        await grantOperatorPass(db, agentId, "expiry", { subscriptionId: subId });
        outcome = "expiry";
      }
    }
  }

  await db.query(`update operator_pass_events set user_id = $2, stripe_subscription_id = $3, outcome = $4 where event_id = $1`, [event.data.id, agentId, subId, outcome]);
  return json({ received: true });
});

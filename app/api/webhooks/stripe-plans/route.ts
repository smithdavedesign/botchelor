import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import {
  checkoutOwner,
  grantPlan,
  invoicePeriodEnd,
  invoiceSubscription,
  plansOn,
  sendPlanEmail,
  subscriptionEnding,
  subscriptionOwner,
  subscriptionPeriodEnd,
  type PlanOwner,
} from "@/lib/paid-plans";
import { testEventsGrant, verifyStripeSignature } from "@/lib/stripe";

/** Subscription events are a few KB; anything this big isn't one. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

const StripeEvent = z.object({
  id: z.string(),
  type: z.string(),
  livemode: z.boolean().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const invalidPayload = () => json({ error: "invalid_payload" }, 400);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * The plans' Stripe subscription webhook (lib/paid-plans.ts): its own endpoint and secret (STRIPE_PLANS_WEBHOOK_SECRET),
 * apart from the token packs' and the operator pass's. It 404s until a plan is on sale. The signature is checked over
 * the raw text and each event is applied once (plan_events). A subscription checkout starts the plan (and sends the
 * confirmation with how to cancel, to the address they paid with); a renewal invoice extends it; a cancel keeps it to the period's end, a resume undoes
 * that, and a deleted subscription ends it. Payloads from before and after Stripe's 2025-03-31 API both read.
 */
export const POST = handle(async (req) => {
  if (!plansOn()) return json({ error: "not_found" }, 404);
  const secret = process.env.STRIPE_PLANS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[plans] STRIPE_PLANS_WEBHOOK_SECRET is not set; refusing the event so Stripe retries later");
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
    console.warn(`[plans] test-mode ${event.data.type} ignored on production (event ${event.data.id})`);
    return json({ received: true });
  }

  const db = await getDb();
  // Each event once: a retry inserts nothing and stops here.
  const fresh = await db.query(
    `insert into plan_events (event_id, type, outcome) values ($1, $2, 'received') on conflict (event_id) do nothing returning event_id`,
    [event.data.id.slice(0, 120), event.data.type.slice(0, 80)],
  );
  if (!fresh.rows.length) return json({ received: true });

  const o = event.data.data.object;
  let owner: PlanOwner | null = null;
  let subId: string | null = null;
  let outcome = "ignored";

  if (event.data.type === "checkout.session.completed") {
    const checkout = str(o.client_reference_id);
    if (o.mode === "subscription" && o.payment_status === "paid" && checkout) {
      owner = await checkoutOwner(db, checkout);
      subId = str(o.subscription);
      if (owner) {
        const email = str((o.customer_details as Record<string, unknown> | undefined)?.email);
        await grantPlan(db, owner.userId, owner.plan, "initial", { subscriptionId: subId, email });
        track("purchase_completed", { product: `${owner.plan}_plan` });
        outcome = "initial";
        await sendPlanEmail(db, owner.userId, owner.plan, "confirmation").catch((err) => console.error(`[plans] confirmation failed: ${err instanceof Error ? err.message : err}`));
      }
    }
  } else if (event.data.type === "invoice.paid") {
    subId = invoiceSubscription(o);
    if (subId && o.billing_reason === "subscription_cycle") {
      owner = await subscriptionOwner(db, subId);
      if (owner) {
        await grantPlan(db, owner.userId, owner.plan, "rebill", { subscriptionId: subId, periodEnd: invoicePeriodEnd(o) });
        outcome = "rebill";
      }
    }
  } else if (event.data.type === "customer.subscription.updated") {
    subId = str(o.id);
    owner = subId ? await subscriptionOwner(db, subId) : null;
    if (owner) {
      if (subscriptionEnding(o)) {
        await grantPlan(db, owner.userId, owner.plan, "cancel", { subscriptionId: subId, periodEnd: subscriptionPeriodEnd(o) });
        outcome = "cancel";
      } else if (o.status === "active" || o.status === "trialing") {
        await grantPlan(db, owner.userId, owner.plan, "resume", { subscriptionId: subId, periodEnd: subscriptionPeriodEnd(o) });
        outcome = "resume";
      }
    }
  } else if (event.data.type === "customer.subscription.deleted") {
    subId = str(o.id);
    owner = subId ? await subscriptionOwner(db, subId) : null;
    if (owner) {
      await grantPlan(db, owner.userId, owner.plan, "expiry", { subscriptionId: subId });
      outcome = "expiry";
    }
  }

  await db.query(`update plan_events set plan = $2, user_id = $3, stripe_subscription_id = $4, outcome = $5 where event_id = $1`, [
    event.data.id.slice(0, 120),
    owner?.plan ?? null,
    owner?.userId ?? null,
    subId,
    outcome,
  ]);
  return json({ received: true });
});

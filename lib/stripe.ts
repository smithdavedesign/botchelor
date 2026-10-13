/**
 * Stripe, without an API key (the owner's call): buyers pay on the owner's Stripe Payment Link, and the
 * signed webhook tells us they did. This file builds the link for one order and checks webhook
 * signatures with node:crypto. Nothing here, or anywhere in the app, calls Stripe's API.
 *
 * STRIPE_PAYMENT_LINK (or NEXT_PUBLIC_STRIPE_PAYMENT_LINK) switches purchases on: a test-mode link until
 * there is a commercial-use host (BUILD.md). Without a valid one, checkout fails closed with 503.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe's own libraries default to 5 minutes between the signed timestamp and now. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
/** A button label, not a paragraph: anything longer in STRIPE_PRICE_LABEL is cut. */
const MAX_LABEL_LENGTH = 60;

type Env = Record<string, string | undefined>;

/** The owner's Payment Link, read per request so a new link needs no rebuild; null unless it is https. */
export function paymentLinkFromEnv(env: Env = process.env): URL | null {
  const raw = (env.STRIPE_PAYMENT_LINK || env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The link for one order: our random order id as client_reference_id, which Stripe copies into the
 * checkout.session.completed event. Never the session cookie: the link is visible to the buyer, Stripe
 * and anyone with dashboard access. Stripe accepts letters, digits, - and _ there, so a UUID fits.
 */
export function paymentLinkUrl(link: URL, orderId: string): string {
  const url = new URL(link.href);
  url.searchParams.set("client_reference_id", orderId);
  return url.href;
}

/** The Buy button's text, from STRIPE_PRICE_LABEL (set with the link, so it names the link's real price). */
export function priceLabelFromEnv(env: Env, fallback: string): string {
  const label = (env.STRIPE_PRICE_LABEL ?? "").trim();
  return label ? label.slice(0, MAX_LABEL_LENGTH) : fallback;
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

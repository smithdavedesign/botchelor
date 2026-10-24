/**
 * Verotel FlexPay, After Dark's backup processor (docs/after-dark-legal-review.md "Payments"). Pure: no database, no
 * network. Everything here follows FlexPay's own documentation, version 4 (read 2026-10-24):
 *
 *   https://controlcenter.verotel.com/flexpay-doc/subscription.html   the startorder request, postbacks, cancel link
 *   https://github.com/verotel/flexpay-php-client (src/Verotel/FlexPay/Client.php)   the reference signing code
 *
 * Signature (the docs' "Signature calculation", and Client.php _signature): SHA-256, lower-case hex, of the signature
 * key followed by `name=value` for every parameter that has a value, sorted by name, all joined with ":". Values are
 * UTF-8. `email` is never signed (we never send it). The docs' worked example
 *   sha256_hex(<key>:custom1=xxyyzz:description=Super video download:priceAmount=9.99:priceCurrency=USD:shopID=64233:type=purchase:version=4)
 * gives ccaf2357…2f2a; this code reproduces it (checked by hand when it was written; the published key isn't copied
 * into the tests because the secret scanner would flag it).
 *
 * Postbacks are GET requests to the website's "FlexPay postback URL" set in Control Center. A postback is genuine when
 * its signature matches the one computed over all its other parameters (Client.php validate_signature, which also
 * accepts the older SHA-1 form). Verotel wants HTTP 200 and the plain text "OK" within 30 seconds; for a card payment,
 * no OK means Verotel refunds it automatically.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** FlexPay's protocol version these requests speak (the docs' "version … 4 for this version"). */
export const VEROTEL_PROTOCOL_VERSION = "4";
const BASE = "https://secure.verotel.com";
export const VEROTEL_STARTORDER_URL = `${BASE}/startorder`;
export const VEROTEL_CANCEL_URL = `${BASE}/cancel-subscription`;
/**
 * The billing period, ISO 8601. The docs' examples use days (P30D, minimum 7 days); Verotel's own Perl client's example
 * sends P1M. VEROTEL_PERIOD overrides it, should Verotel ask for days.
 */
export const VEROTEL_DEFAULT_PERIOD = "P1M";

type Params = Record<string, string>;
type Env = Record<string, string | undefined>;

export type VerotelConfig = { shopId: string; signatureKey: string; period: string };

/** Verotel's settings, or null when they aren't all set (then Verotel is off). Never logs or returns the key elsewhere. */
export function verotelConfig(env: Env = process.env): VerotelConfig | null {
  const shopId = env.VEROTEL_SHOP_ID?.trim();
  const signatureKey = env.VEROTEL_SIGNATURE_KEY?.trim();
  if (!shopId || !/^\d+$/.test(shopId) || !signatureKey) return null;
  const period = env.VEROTEL_PERIOD?.trim().toUpperCase();
  return { shopId, signatureKey, period: period && /^P\d{1,3}[DMY]$/.test(period) ? period : VEROTEL_DEFAULT_PERIOD };
}

/** The FlexPay signature over `params` (those with a value), as the docs define it. */
export function verotelSignature(signatureKey: string, params: Params, alg: "sha256" | "sha1" = "sha256"): string {
  const pairs = Object.keys(params)
    .filter((k) => k !== "signature" && params[k] !== "" && params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => `${k}=${params[k]}`);
  return createHash(alg).update([signatureKey, ...pairs].join(":"), "utf8").digest("hex").toLowerCase();
}

const sameHex = (a: string, b: string): boolean => {
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Whether a postback's `signature` matches its other parameters (SHA-256, or the older SHA-1 Verotel still accepts). */
export function verotelSignatureValid(signatureKey: string, params: Params): boolean {
  const given = params.signature;
  if (!given || !/^[0-9a-fA-F]{40,64}$/.test(given)) return false;
  return sameHex(given, verotelSignature(signatureKey, params)) || sameHex(given, verotelSignature(signatureKey, params, "sha1"));
}

/** The startorder link for a monthly recurring subscription. referenceID is our order id; Verotel requires it unique. */
export function verotelStartOrderUrl(
  config: VerotelConfig,
  order: { referenceId: string; priceUsd: number; name: string; successUrl: string; declineUrl: string },
): string {
  const params: Params = {
    version: VEROTEL_PROTOCOL_VERSION,
    shopID: config.shopId,
    type: "subscription",
    subscriptionType: "recurring",
    period: config.period,
    priceAmount: order.priceUsd.toFixed(2),
    priceCurrency: "USD",
    // Both are "displayed on the order page", max 100 printable characters: the docs list `name` for subscriptions and
    // sign `description` in their subscription example.
    name: order.name.slice(0, 100),
    description: order.name.slice(0, 100),
    referenceID: order.referenceId,
    // Max 255 characters each; without them Verotel uses the website's default landing pages.
    ...(order.successUrl.length <= 255 ? { successURL: order.successUrl } : {}),
    ...(order.declineUrl.length <= 255 ? { declineURL: order.declineUrl } : {}),
  };
  const signature = verotelSignature(config.signatureKey, params);
  const qs = new URLSearchParams([...Object.keys(params).sort().map((k): [string, string] => [k, params[k]]), ["signature", signature]]);
  return `${VEROTEL_STARTORDER_URL}?${qs}`;
}

/** The subscriber's own cancel link for one sale (the docs' "Cancel subscription request": version, shopID, saleID). */
export function verotelCancelUrl(config: VerotelConfig, saleId: string): string {
  const params: Params = { version: VEROTEL_PROTOCOL_VERSION, shopID: config.shopId, saleID: saleId };
  return `${VEROTEL_CANCEL_URL}?${new URLSearchParams({ ...params, signature: verotelSignature(config.signatureKey, params) })}`;
}

/** What one postback means for the subscription, in the shared terms lib/adult/billing.ts applies. */
export type BillingKind = "initial" | "rebill" | "extend" | "uncancel" | "cancel" | "expiry" | "chargeback" | "refund" | "declined" | "ignored";

export type ParsedPostback = {
  kind: BillingKind;
  /** The processor's own event name, as sent. */
  rawEvent: string;
  /** The processor's transaction id, when the postback carries one (rebill, credit, chargeback; initial on postback v2). */
  transactionId: string | null;
  /** Our order id (Verotel referenceID). */
  orderId: string | null;
  /** The processor's subscription id (Verotel saleID). */
  saleId: string | null;
  /** When access runs to: the next charge or the expiry, if the postback says. */
  periodEnd: Date | null;
  amount: string | null;
  currency: string | null;
  /** The parameters worth keeping (no card or personal data), for disputes. */
  kept: Params;
};

/** Verotel's postback parameters kept with the event: identifiers, amounts and dates; never truncatedPAN, CCBrand or email. */
const VEROTEL_KEPT = [
  "shopID", "type", "subscriptionType", "event", "referenceID", "saleID", "transactionID", "parentID", "precededBySaleID",
  "priceAmount", "priceCurrency", "amount", "currency", "period", "trialAmount", "trialPeriod", "nextChargeOn", "expiresOn",
  "subscriptionPhase", "cancelledBy", "uncancelledBy", "paymentMethod", "custom1", "custom2", "custom3",
] as const;

/** A FlexPay date (yyyy-mm-dd) as the end of that day's access: the start of the next day, UTC. */
export function verotelDate(value: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A verified postback's meaning. Events (the docs' "Postbacks"): initial, rebill, extend, downgrade, cancel, uncancel,
 * expiry, credit, chargeback, upgrade. A credit that leaves the subscription running (subscriptionPhase "normal": a
 * partial credit without termination) is recorded but changes nothing; a full one ends it, as a refund.
 */
export function parseVerotelPostback(params: Params): ParsedPostback {
  const event = (params.event ?? "").trim().toLowerCase();
  const kept: Params = {};
  for (const k of VEROTEL_KEPT) if (params[k] !== undefined && params[k] !== "") kept[k] = String(params[k]).slice(0, 200);
  const kind: BillingKind = (() => {
    switch (event) {
      case "initial":
      case "upgrade":
        return "initial";
      case "rebill":
        return "rebill";
      case "extend":
        return "extend";
      case "uncancel":
        return "uncancel";
      case "cancel":
        return "cancel";
      case "expiry":
        return "expiry";
      case "chargeback":
        return "chargeback";
      case "credit":
        return params.subscriptionPhase?.trim().toLowerCase() === "normal" ? "ignored" : "refund";
      default:
        return "ignored"; // downgrade, and anything new
    }
  })();
  return {
    kind,
    rawEvent: event || "(none)",
    transactionId: params.transactionID?.trim() || null,
    orderId: params.referenceID?.trim() || null,
    saleId: params.saleID?.trim() || null,
    periodEnd: verotelDate(params.nextChargeOn) ?? verotelDate(params.expiresOn),
    amount: params.priceAmount ?? params.amount ?? null,
    currency: params.priceCurrency ?? params.currency ?? null,
    kept,
  };
}

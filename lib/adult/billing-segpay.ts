/**
 * Segpay, After Dark's primary processor (docs/after-dark-legal-review.md "Payments": the only one with a published AI
 * route). Pure: no database, no network. Following Segpay's own help center (read 2026-10-24):
 *
 *   https://gethelp.segpay.com/docs/Content/DeveloperDocs/ProcessingAPI/02-Parameters-PopulateFields.htm
 *       the hosted payment page: https://secure2.segpay.com/billing/poset.cgi?x-eticketid=<package id>:<price point id>,
 *       REF1–REF10 for our own reference (stored encrypted, returned in postbacks), x-auth-link / x-decl-link for where
 *       the buyer goes after an approval or a decline. User-defined values are at most 32 characters and can't start
 *       with a digit, so our order id is `ado_` and 24 hex characters.
 *   https://gethelp.segpay.com/docs/Content/DeveloperDocs/ProcessingAPI/06-Postbacks.htm
 *       postbacks are configured in the Merchant Portal (My Websites > Manage Postbacks) as a URL with <macro>s, an
 *       "Expected Response" (we answer OK) and retries. Two families: Member Management (Inquiry, Enable, Disable,
 *       Cancellation, Reactivation; synchronous) and Transaction ("TransPost": every payment, refund, void, chargeback).
 *   https://gethelp.segpay.com/docs/Content/DeveloperDocs/ProcessingAPI/07-PostbackParameters.htm   the macros
 *   https://gethelp.segpay.com/docs/Content/DeveloperDocs/ProcessingAPI/Postbacks-TransactionMatrix.htm
 *       trantype × action × stage × approved: Sale/Auth/Initial/Yes is an approved signup, …/Conversion and …/Rebill an
 *       approved renewal, Sale/Void a void, Credit a refund, Charge a chargeback, CBReversal a chargeback won back,
 *       RDRreversal an RDR refund, Revoke a reversed transaction.
 *
 * Authentication: Segpay postbacks carry no signature (there is no HMAC to check), so the URL pasted into the portal
 * carries a long random secret of ours (?secret=…, SEGPAY_POSTBACK_SECRET), compared in constant time; SEGPAY_POSTBACK_IPS
 * can also limit them to Segpay's addresses (ask Segpay for the list). The price is the price point's, set in the
 * portal: AD_SUBSCRIPTION_PRICE_USD must say the same, because it's what our page shows. (Segpay's "Hosted Pay Page
 * Signed Requests", for prices set per request, isn't used.)
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { BillingKind, ParsedPostback } from "./billing-verotel";

export const SEGPAY_PAY_PAGE_URL = "https://secure2.segpay.com/billing/poset.cgi";

type Params = Record<string, string>;
type Env = Record<string, string | undefined>;

export type SegpayConfig = { packageId: string; pricePointId: string; postbackSecret: string; postbackIps: string[] };

/** The shortest postback secret we accept: a guessable one would let anyone switch a subscription on. */
export const SEGPAY_SECRET_MIN = 32;

/** Segpay's settings, or null when they aren't all set (then Segpay is off). */
export function segpayConfig(env: Env = process.env): SegpayConfig | null {
  const packageId = env.SEGPAY_PACKAGE_ID?.trim();
  const pricePointId = env.SEGPAY_PRICE_POINT_ID?.trim();
  const postbackSecret = env.SEGPAY_POSTBACK_SECRET?.trim();
  if (!packageId || !/^\d+$/.test(packageId) || !pricePointId || !/^\d+$/.test(pricePointId)) return null;
  if (!postbackSecret || postbackSecret.length < SEGPAY_SECRET_MIN) return null;
  const postbackIps = (env.SEGPAY_POSTBACK_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { packageId, pricePointId, postbackSecret, postbackIps };
}

/** The hosted payment page for one order. */
export function segpayPayPageUrl(config: SegpayConfig, order: { referenceId: string; successUrl: string; declineUrl: string }): string {
  const qs = new URLSearchParams({
    "x-eticketid": `${config.packageId}:${config.pricePointId}`,
    REF1: order.referenceId,
    "x-auth-link": order.successUrl,
    "x-auth-text": "Back to Botchelor",
    "x-decl-link": order.declineUrl,
    "x-decl-text": "Back to Botchelor",
  });
  return `${SEGPAY_PAY_PAGE_URL}?${qs}`;
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Whether a postback came with our secret (constant time, whatever its length) and, when an allowlist is set, from it. */
export function segpayPostbackAuthorized(config: SegpayConfig, given: string | null, ip: string | null): boolean {
  const ok = timingSafeEqual(digest(given ?? ""), digest(config.postbackSecret)) && Boolean(given);
  if (!ok) return false;
  return config.postbackIps.length === 0 || (ip !== null && config.postbackIps.includes(ip));
}

/** Segpay's postback parameters kept with the event: identifiers, amounts, stages and dates; no name, email, address, IP or card digits. */
const SEGPAY_KEPT = [
  "action", "stage", "approved", "trantype", "purchaseid", "tranid", "relatedtranid", "transguid", "price", "currencycode",
  "eticketid", "ival", "iint", "rval", "rint", "desc", "ref1", "transtime", "standin", "xsellnum", "urlid", "nextbilldate",
  "lastbilldate", "reactivationtimestamp", "cancelreasoncode", "refundreasoncode", "singleusepromo",
] as const;

/** Segpay sends its names in either case ("Postbacks may include upper and lower-case characters"): one lower-case map. */
export function lowerKeys(params: Params): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) out[k.toLowerCase().replace(/\s+/g, "")] = v;
  return out;
}

/** mm/dd/yyyy (Reactivation's nextbilldate) as the start of that day, UTC. */
export function segpayDate(value: string | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value?.trim() ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}

const days = (value: string | undefined, now: Date): Date | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 400 ? new Date(now.getTime() + n * 86_400_000) : null;
};

/**
 * One postback's meaning. Transaction postbacks name a `trantype`; Member Management postbacks only an `action`
 * (Cancel/Cancellation, Disable, Reactivation, Enable, Inquiry). Access runs `iint` days after a signup (the initial
 * period) and `rint` days after a renewal; with neither, billing.ts gives a month.
 */
export function parseSegpayPostback(raw: Params, now = new Date()): ParsedPostback {
  const p = lowerKeys(raw);
  const action = (p.action ?? "").trim().toLowerCase();
  const trantype = (p.trantype ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const stage = (p.stage ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const approved = (p.approved ?? "").trim().toLowerCase() === "yes";
  const kept: Params = {};
  for (const k of SEGPAY_KEPT) if (p[k] !== undefined && p[k] !== "") kept[k] = String(p[k]).slice(0, 200);
  let kind: BillingKind = "ignored";
  let periodEnd: Date | null = null;
  if (trantype) {
    if (trantype === "sale" && action === "void") kind = approved ? "refund" : "ignored";
    else if (trantype === "sale") {
      if (!approved) kind = "declined";
      else if (stage === "initial") {
        kind = "initial";
        periodEnd = days(p.iint, now) ?? days(p.rint, now);
      } else if (stage === "conversion" || stage === "rebill" || stage === "instantconversion") {
        kind = "rebill";
        periodEnd = days(p.rint, now);
      }
    } else if (trantype === "charge") kind = "chargeback";
    else if (trantype === "credit" || trantype === "rdrreversal" || trantype === "revoke") kind = "refund";
    // cbreversal (a chargeback won back) is recorded; the account stays as it is until someone looks.
  } else if (action === "cancel" || action === "cancellation") kind = "cancel";
  else if (action === "disable") kind = "expiry";
  else if (action === "reactivation") {
    kind = "uncancel";
    periodEnd = segpayDate(p.nextbilldate);
  }
  return {
    kind,
    rawEvent: [trantype || null, action || null, stage || null, trantype ? (approved ? "approved" : "not-approved") : null].filter(Boolean).join("/") || "(none)",
    // Only a transaction postback's tranid identifies it: a Disable after a chargeback carries the chargeback's tranid
    // too, and must not stand in for (and so swallow) the chargeback's own postback.
    transactionId: trantype ? p.tranid?.trim() || null : null,
    orderId: p.ref1?.trim() || p["extraref1"]?.trim() || null,
    saleId: p.purchaseid?.trim() || null,
    periodEnd,
    amount: p.price ?? p.rval ?? null,
    currency: p.currencycode ?? null,
    kept,
  };
}

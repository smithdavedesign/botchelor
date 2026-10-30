/**
 * CCBill, After Dark's first-choice processor (David's pick, 2026-10-30: Segpay and Verotel stay as the backups). Pure:
 * no database, no network. Everything here follows CCBill's own documentation (read 2026-10-30):
 *
 *   https://ccbill.com/doc/dynamic-pricing          the FlexForms link: api.ccbill.com/wap-frontflex/flexforms/<flexId>
 *   https://ccbill.com/doc/dynamic-pricing-user-guide  prices with two decimals, periods in days, currency 840 = USD
 *   https://ccbill.com/doc/formdigest-value         formDigest = md5(initialPrice initialPeriod recurringPrice
 *                                                    recurringPeriod numRebills currencyCode salt), concatenated
 *   https://ccbill.com/doc/webhooks-user-guide      the events (NewSaleSuccess, RenewalSuccess, Cancellation,
 *                                                    Expiration, Chargeback, Refund…), JSON or form posts with
 *                                                    clientAccnum, clientSubacc, eventType in the query; pass-through
 *                                                    values prefixed X- come back as sent; CCBill's sending ranges
 *   https://ccbill.com/doc/newsalesuccess           subscriptionId, transactionId, nextRenewalDate, billed* fields
 *
 * The docs' worked digest examples (recurring "10.003010.0030998407d901dad245fd0ff6bc20d06" → 48f0b12e…c899, single
 * "10.00308407d901dad245fd0ff6bc20d06" → a7459445…900b) are reproduced in tests/after-dark-billing-ccbill.test.ts.
 *
 * CCBill's webhooks carry no signature. The docs offer their sending IP ranges, but behind Cloudflare and DigitalOcean
 * the forwarded address can be forged by the caller, so a webhook is genuine only when its URL carries our own secret
 * (CCBILL_WEBHOOK_KEY, put in the webhook URL in CCBill's admin) and it names our account and subaccount. A
 * Cloudflare-reported address outside CCBill's ranges is refused too.
 */
import { createHash } from "node:crypto";
import type { BillingKind, ParsedPostback } from "./billing-verotel";

type Params = Record<string, string>;
type Env = Record<string, string | undefined>;

export const CCBILL_FLEXFORMS_BASE = "https://api.ccbill.com/wap-frontflex/flexforms";
/** USD, as CCBill numbers currencies. */
export const CCBILL_USD = "840";
/** A month, in CCBill's days. */
export const CCBILL_PERIOD_DAYS = 30;
/** Rebill until cancelled (the docs' default for a recurring price). */
export const CCBILL_REBILLS = 99;

export type CcbillConfig = { accnum: string; subacc: string; flexId: string; salt: string; webhookKey: string };

/** CCBill's settings, or null when they aren't all set (then CCBill is off). */
export function ccbillConfig(env: Env = process.env): CcbillConfig | null {
  const accnum = env.CCBILL_ACCOUNT?.trim();
  const subacc = env.CCBILL_SUBACCOUNT?.trim();
  const flexId = env.CCBILL_FLEX_ID?.trim();
  const salt = env.CCBILL_SALT?.trim();
  const webhookKey = env.CCBILL_WEBHOOK_KEY?.trim();
  if (!accnum || !/^\d+$/.test(accnum) || !subacc || !/^\d+$/.test(subacc) || !flexId || !/^[\w-]+$/.test(flexId) || !salt || !webhookKey || webhookKey.length < 24) return null;
  return { accnum, subacc, flexId, salt, webhookKey };
}

/** The formDigest of a recurring price, as CCBill's docs define it. */
export function ccbillDigest(salt: string, p: { initialPrice: string; initialPeriod: string; recurringPrice: string; recurringPeriod: string; numRebills: string; currencyCode: string }): string {
  return createHash("md5").update(`${p.initialPrice}${p.initialPeriod}${p.recurringPrice}${p.recurringPeriod}${p.numRebills}${p.currencyCode}${salt}`).digest("hex");
}

/** The formDigest of a single (one-time) price. */
export function ccbillSingleDigest(salt: string, p: { initialPrice: string; initialPeriod: string; currencyCode: string }): string {
  return createHash("md5").update(`${p.initialPrice}${p.initialPeriod}${p.currencyCode}${salt}`).digest("hex");
}

/** The FlexForms link for a monthly subscription; our order id travels as the pass-through X-orderId. */
export function ccbillPayUrl(config: CcbillConfig, order: { referenceId: string; priceUsd: number }): string {
  const price = order.priceUsd.toFixed(2);
  const p = {
    initialPrice: price,
    initialPeriod: String(CCBILL_PERIOD_DAYS),
    recurringPrice: price,
    recurringPeriod: String(CCBILL_PERIOD_DAYS),
    numRebills: String(CCBILL_REBILLS),
    currencyCode: CCBILL_USD,
  };
  const qs = new URLSearchParams({ clientAccnum: config.accnum, clientSubacc: config.subacc, ...p, formDigest: ccbillDigest(config.salt, p), "X-orderId": order.referenceId });
  return `${CCBILL_FLEXFORMS_BASE}/${encodeURIComponent(config.flexId)}?${qs}`;
}

/** CCBill's sending ranges (the webhooks guide): 64.38.212/215/240/241.1–254. */
export function ccbillAddress(ip: string | null): boolean {
  const m = /^64\.38\.(212|215|240|241)\.(\d{1,3})$/.exec(ip?.trim() ?? "");
  return Boolean(m && Number(m[2]) >= 1 && Number(m[2]) <= 254);
}

/** Identifiers, amounts and dates; never names, addresses, emails, card details or the username and password fields. */
const CCBILL_KEPT = [
  "eventType", "subscriptionId", "transactionId", "clientAccnum", "clientSubacc", "subscriptionTypeId", "flexId", "timestamp",
  "nextRenewalDate", "renewalDate", "billedInitialPrice", "billedRecurringPrice", "billedCurrencyCode", "billedAmount",
  "billedCurrency", "accountingAmount", "accountingCurrency", "initialPeriod", "recurringPeriod", "rebills", "reason", "source",
  "X-orderId",
] as const;

/** A CCBill date ("2026-11-29" or "2026-11-29 12:00:00") as the end of that day's access: the start of the next day, UTC. */
export function ccbillDate(value: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A webhook's meaning, in the shared terms lib/adult/billing.ts applies. `eventType` comes from the query string. */
export function parseCcbillWebhook(eventType: string, params: Params): ParsedPostback {
  const event = eventType.trim();
  const kept: Params = { eventType: event };
  for (const k of CCBILL_KEPT) if (k !== "eventType" && params[k] !== undefined && params[k] !== "") kept[k] = String(params[k]).slice(0, 200);
  const kind: BillingKind = (() => {
    switch (event) {
      case "NewSaleSuccess":
        return "initial";
      case "RenewalSuccess":
        return "rebill";
      case "Cancellation":
        return "cancel";
      case "Expiration":
        return "expiry";
      case "Chargeback":
        return "chargeback";
      case "Refund":
      case "Void":
        return "refund";
      case "NewSaleFailure":
        return "declined";
      default:
        return "ignored"; // RenewalFailure (CCBill retries), UpgradeSuccess, UserReactivation…, and anything new
    }
  })();
  return {
    kind,
    rawEvent: event || "(none)",
    transactionId: params.transactionId?.trim() || null,
    orderId: params["X-orderId"]?.trim() || null,
    saleId: params.subscriptionId?.trim() || null,
    periodEnd: ccbillDate(params.nextRenewalDate) ?? ccbillDate(params.renewalDate),
    amount: params.billedInitialPrice ?? params.billedAmount ?? params.accountingAmount ?? null,
    currency: params.billedCurrencyCode ?? params.billedCurrency ?? params.accountingCurrency ?? null,
    kept,
  };
}

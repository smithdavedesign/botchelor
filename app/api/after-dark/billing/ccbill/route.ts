import { applyBillingEvent, logPostback, plainText, postbackParams } from "@/lib/adult/billing";
import { ccbillAddress, ccbillConfig, parseCcbillWebhook } from "@/lib/adult/billing-ccbill";
import { getDb } from "@/lib/db";
import { handle, json, safeEqual } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";

export const dynamic = "force-dynamic";

/** Webhooks without our key, per address: CCBill's own always carry it. */
const BAD_POSTBACK_LIMITS = { perHour: 20, perDay: 100 };

/**
 * CCBill's webhooks (lib/adult/billing-ccbill.ts; https://ccbill.com/doc/webhooks-user-guide): a POST, JSON or form, with
 * clientAccnum, clientSubacc and eventType in the query, for every new sale, renewal, cancellation, expiration, refund,
 * void and chargeback. Set in CCBill's admin as this URL with `?key=` CCBILL_WEBHOOK_KEY (CCBill signs nothing, so the
 * key is the check, in constant time), and it must name our account and subaccount; where Cloudflare reports the caller's
 * address, it must be one of CCBill's. Not found while CCBill isn't configured. A genuine webhook is recorded and applied
 * once and answered 200.
 */
export const POST = handle(async (req: Request) => {
  const config = ccbillConfig();
  if (!config) return json({ error: "not_found" }, 404);
  const db = await getDb();
  const params = await postbackParams(req);
  const key = params.key ?? "";
  delete params.key;
  const cfAddress = req.headers.get("cf-connecting-ip");
  const genuine =
    safeEqual(key, config.webhookKey) && safeEqual(params.clientAccnum ?? "", config.accnum) && safeEqual(params.clientSubacc ?? "", config.subacc) && (!cfAddress || ccbillAddress(cfAddress));
  if (!genuine) {
    const visitor = visitorKey(req.headers);
    if (visitor && (await overLimit(db, "ad_billing_bad", visitor, BAD_POSTBACK_LIMITS))) return plainText("ERROR", 429);
    logPostback("ccbill", "unverified", "refused");
    return plainText("ERROR", 403);
  }
  const ev = parseCcbillWebhook(params.eventType ?? "", params);
  const outcome = await applyBillingEvent(db, "ccbill", ev);
  logPostback("ccbill", ev.kind, outcome);
  return plainText("OK");
});

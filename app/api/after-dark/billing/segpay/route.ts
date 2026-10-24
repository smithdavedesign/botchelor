import { applyBillingEvent, logPostback, plainText, postbackParams } from "@/lib/adult/billing";
import { parseSegpayPostback, segpayConfig, segpayPostbackAuthorized } from "@/lib/adult/billing-segpay";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { clientIp, overLimit, visitorKey } from "@/lib/limits";

export const dynamic = "force-dynamic";

/** Postbacks without our secret, per address: Segpay's own always carry it. */
const BAD_POSTBACK_LIMITS = { perHour: 20, perDay: 100 };

/**
 * Segpay's postbacks (lib/adult/billing-segpay.ts; https://gethelp.segpay.com/docs/Content/DeveloperDocs/ProcessingAPI/06-Postbacks.htm):
 * the Transaction postback (every signup, renewal, refund, void and chargeback) and the Member Management Cancellation,
 * Disable and Reactivation postbacks, each configured in the Merchant Portal as this URL with `?secret=` and the macros
 * listed in docs/after-dark.md "Billing". Segpay signs nothing, so the secret in the URL is the check (constant time),
 * with an optional allowlist of Segpay's addresses (SEGPAY_POSTBACK_IPS). Not found while Segpay isn't configured. A
 * genuine postback is recorded and applied once and answered "OK" (set "OK" as the Expected Response in the portal).
 */
async function receive(req: Request): Promise<Response> {
  const config = segpayConfig();
  if (!config) return json({ error: "not_found" }, 404);
  const db = await getDb();
  const params = await postbackParams(req);
  const secret = params.secret ?? null;
  delete params.secret;
  if (!segpayPostbackAuthorized(config, secret, clientIp(req.headers))) {
    const visitor = visitorKey(req.headers);
    if (visitor && (await overLimit(db, "ad_billing_bad", visitor, BAD_POSTBACK_LIMITS))) return plainText("ERROR", 429);
    logPostback("segpay", "unverified", "refused");
    return plainText("ERROR", 403);
  }
  const ev = parseSegpayPostback(params);
  const outcome = await applyBillingEvent(db, "segpay", ev);
  logPostback("segpay", ev.kind, outcome);
  return plainText("OK");
}

export const GET = handle(receive);
export const POST = handle(receive);

import { applyBillingEvent, logPostback, plainText, postbackParams } from "@/lib/adult/billing";
import { parseVerotelPostback, verotelConfig, verotelSignatureValid } from "@/lib/adult/billing-verotel";
import { getDb } from "@/lib/db";
import { handle, json, safeEqual } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";

export const dynamic = "force-dynamic";

/** Postbacks that fail the signature, per address: Verotel's own never do, so a few an hour is plenty. */
const BAD_POSTBACK_LIMITS = { perHour: 20, perDay: 100 };

/**
 * Verotel FlexPay's postback (lib/adult/billing-verotel.ts; https://controlcenter.verotel.com/flexpay-doc/subscription.html
 * "Postbacks"): a GET to the website's FlexPay postback URL after every sale, rebill, cancel, expiry, credit and
 * chargeback. Not found while Verotel isn't configured. A wrong signature or shop is refused (400); a genuine postback is
 * recorded and applied once, and answered with the plain text "OK" Verotel waits for. A first sale we can't place (no
 * such order, or its account deleted) is answered with an error instead, so Verotel refunds the card automatically
 * rather than charging someone who'll get nothing.
 */
export const GET = handle(async (req: Request) => {
  const config = verotelConfig();
  if (!config) return json({ error: "not_found" }, 404);
  const db = await getDb();
  const params = await postbackParams(req);
  if (!verotelSignatureValid(config.signatureKey, params) || !safeEqual(params.shopID ?? "", config.shopId)) {
    const visitor = visitorKey(req.headers);
    if (visitor && (await overLimit(db, "ad_billing_bad", visitor, BAD_POSTBACK_LIMITS))) return plainText("ERROR - too many", 429);
    logPostback("verotel", "unverified", "refused");
    return plainText("ERROR - Invalid signature!", 400);
  }
  const ev = parseVerotelPostback(params);
  const outcome = await applyBillingEvent(db, "verotel", ev);
  logPostback("verotel", ev.kind, outcome);
  if (ev.kind === "initial" && (outcome === "unknown_order" || outcome === "no_account")) return plainText("ERROR - unknown order", 400);
  return plainText("OK");
});

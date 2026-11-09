import { applyDecision, diditConfig, diditSignatureOk } from "@/lib/adult/age-check";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";

export const dynamic = "force-dynamic";

/** Unsigned or badly signed posts, per address: Didit's own are always signed. */
const BAD_WEBHOOK_LIMITS = { perHour: 20, perDay: 100 };
/** Didit's bodies are small; anything bigger isn't one. */
const MAX_WEBHOOK_BYTES = 200_000;

/**
 * Didit's webhooks (lib/adult/age-check.ts; https://docs.didit.me/integration/webhooks): set in Didit's console as
 * After Dark's own address + /api/after-dark/verify/webhook, for status.updated. Only a body whose signature checks
 * (X-Timestamp fresh, X-Signature or X-Signature-V2 under DIDIT_WEBHOOK_SECRET) is read; an Approved or Declined
 * status is recorded for the person in vendor_data, once. Not found while Didit isn't set up.
 */
export const POST = handle(async (req: Request) => {
  const config = diditConfig();
  if (!config) return json({ error: "not_found" }, 404);
  const raw = await req.text();
  if (raw.length > MAX_WEBHOOK_BYTES || !diditSignatureOk(raw, req.headers, config.webhookSecret)) {
    const db = await getDb();
    const visitor = visitorKey(req.headers);
    if (visitor && (await overLimit(db, "ad_verify_bad", visitor, BAD_WEBHOOK_LIMITS))) return json({ error: "rate_limited" }, 429);
    console.error("[age-check] refused a webhook with a bad signature");
    return json({ error: "bad_signature" }, 401);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_body" }, 400);
  }
  const outcome = await applyDecision(await getDb(), body);
  return json({ ok: true, outcome });
});

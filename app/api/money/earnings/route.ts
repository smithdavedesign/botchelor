import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { earningsOf, PAYOUT_HANDLE_MAX, PAYOUT_METHODS, setPayoutMethod } from "@/lib/money/earnings";

export const dynamic = "force-dynamic";

/** GET: your characters' earnings (paid tips and template sales), your share, what's been paid out and what's owed. */
export const GET = handle(async (req) => {
  const sess = session(req);
  return json(await earningsOf(await getDb(), sess.userId), 200, sess);
});

const Method = z.object({ method: z.enum(PAYOUT_METHODS), handle: z.string().max(PAYOUT_HANDLE_MAX + 50) });

/** POST: where to send your payouts (a PayPal or Wise email, or a note for a bank transfer). Needs an account. */
export const POST = handle(async (req) => {
  const sess = session(req);
  if (!sess.authenticated) return json({ error: "account_required", message: "Make a free account first, so your earnings stay yours." }, 401, sess);
  const input = parseBody(Method, await readJson(req), "invalid_request");
  const r = await setPayoutMethod(await getDb(), sess.userId, input);
  return r.ok ? json({ ok: true }, 200, sess) : json({ error: r.code, message: r.error }, 400, sess);
});

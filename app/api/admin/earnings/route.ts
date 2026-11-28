import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { recordPayout, showEarnings } from "@/lib/money/earnings";

export const dynamic = "force-dynamic";

const denied = () => json({ error: "not_authorized", message: "Needs an admin account." }, 401);

/** GET: every creator's earnings and balance, and the show's totals (lib/money/earnings.ts showEarnings). Admins only. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return denied();
  return json(await showEarnings(db));
});

const Payout = z.object({ user_id: z.string().min(1).max(80), amount_cents: z.number().int().positive(), note: z.string().max(400).optional() });

/** POST: record a payout made by hand, which comes off that creator's balance. Admins only. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const auth = authFromRequest(req);
  if (!auth || !(await isSignedInAdmin(db, auth))) return denied();
  const input = parseBody(Payout, await readJson(req), "invalid_request");
  const r = await recordPayout(db, auth.userId, input);
  return r.ok ? json({ ok: true, id: r.id }) : json({ error: r.code, message: r.error }, 400);
});

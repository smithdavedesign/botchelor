import { z } from "zod";
import { claimCookie } from "@/lib/account-claim";
import { AuthError, PASSWORD_MAX, PASSWORD_MIN, registerAccount, sessionsSignable } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, json, jsonWithSession, parseBody, readJson, session } from "@/lib/http";
import { overLimit, REGISTER_LIMITS, visitorKey } from "@/lib/limits";
import { welcome } from "@/lib/notifications";
import { assertSafeName } from "@/lib/people";

const RegisterInput = z.object({
  handle: z.string().trim().min(3).max(20),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  attest: z.literal(true, "Confirm you are 18 or older."),
});

/**
 * Create a handle+password account. It adopts the current anonymous session id, so any characters and dates
 * already made in this browser stay the user's. The account's handle also seeds a display name if none is set.
 * Needs SESSION_SECRET (so the session can be signed); without it, accounts are unavailable.
 */
export const POST = handle(async (req) => {
  if (!sessionsSignable()) return json({ error: "accounts_unavailable", message: "Accounts are not enabled on this deployment yet." }, 503);
  const sess = session(req);
  const input = parseBody(RegisterInput, await readJson(req), "invalid_registration");
  assertSafeName(input.handle, "handle");

  const db = await getDb();
  // Sign-ups from one address (lib/limits.ts REGISTER_LIMITS), before the password is hashed.
  const visitor = visitorKey(req.headers);
  if (visitor && (await overLimit(db, "register", visitor, REGISTER_LIMITS))) {
    return json({ error: "too_many_signups", message: "That's a lot of new accounts from one connection. Try again in an hour." }, 429);
  }
  try {
    const account = await registerAccount(db, sess.userId, input.handle, input.password);
    // The account's first notice (lib/notifications.ts welcome): never in the way of the sign-up itself.
    await welcome(db, account.user_id).catch(() => {});
    // Seed a display name from the handle if the user hasn't picked one (leagues/reveals need one).
    await db.query(
      `insert into profiles (user_id, name) values ($1, $2) on conflict (user_id) do nothing`,
      [account.user_id, account.handle_display ?? input.handle],
    );
    // Signing up adopts this browser's id, so nothing is left behind: an older offer (lib/account-claim.ts) is dropped.
    return jsonWithSession({ authenticated: true, handle: account.handle_display }, { userId: account.user_id, authenticated: true }, 201, [claimCookie(null)]);
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.code, message: err.message }, err.status);
    throw err;
  }
});

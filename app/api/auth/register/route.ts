import { z } from "zod";
import { AuthError, PASSWORD_MAX, PASSWORD_MIN, registerAccount, sessionsSignable } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, json, jsonWithSession, parseBody, readJson, session } from "@/lib/http";
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
  try {
    const account = await registerAccount(db, sess.userId, input.handle, input.password);
    // Seed a display name from the handle if the user hasn't picked one (leagues/reveals need one).
    await db.query(
      `insert into profiles (user_id, name) values ($1, $2) on conflict (user_id) do nothing`,
      [account.user_id, account.handle_display ?? input.handle],
    );
    return jsonWithSession({ authenticated: true, handle: account.handle_display }, { userId: account.user_id, authenticated: true }, 201);
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.code, message: err.message }, err.status);
    throw err;
  }
});

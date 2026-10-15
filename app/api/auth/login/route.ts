import { z } from "zod";
import { accountForUser, AuthError, loginWithPassword, sessionsSignable } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, json, jsonWithSession, parseBody, readJson } from "@/lib/http";

const LoginInput = z.object({ handle: z.string().trim().min(1).max(40), password: z.string().min(1).max(400) });

/** Sign in with a handle and password. The session id becomes that account's id (its characters and dates). */
export const POST = handle(async (req) => {
  if (!sessionsSignable()) return json({ error: "accounts_unavailable", message: "Accounts are not enabled on this deployment yet." }, 503);
  const input = parseBody(LoginInput, await readJson(req), "invalid_login");
  const db = await getDb();
  try {
    const userId = await loginWithPassword(db, input.handle, input.password);
    const account = await accountForUser(db, userId);
    return jsonWithSession({ authenticated: true, handle: account?.handle_display ?? null }, { userId, authenticated: true });
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.code, message: err.message }, err.status);
    throw err;
  }
});

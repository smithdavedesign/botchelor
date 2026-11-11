import { z } from "zod";
import { resetLinkAccount, resetPassword } from "@/lib/account-recovery";
import { PASSWORD_MAX, PASSWORD_MIN, sessionsSignable } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, json, jsonWithSession, parseBody, readJson } from "@/lib/http";

const ResetInput = z.object({
  t: z.string().min(10).max(2000),
  password: z.string().min(PASSWORD_MIN, `The new password needs at least ${PASSWORD_MIN} characters.`).max(PASSWORD_MAX).optional(),
});

const deadLink = () =>
  json({ error: "invalid_link", message: "That link doesn't work any more: each one lasts an hour and works once. Ask for a new one under Sign in." }, 400);

/**
 * The reset page (app/email/reset-password, lib/account-recovery.ts). With only the link's token: whether the link still
 * works, and whose it is, so the page can say so before anyone types. With a password too: that becomes the account's
 * password, the link stops working, and this browser is signed in to the account.
 */
export const POST = handle(async (req) => {
  if (!sessionsSignable()) return json({ error: "accounts_unavailable", message: "Accounts are not enabled on this deployment yet." }, 503);
  const input = parseBody(ResetInput, await readJson(req), "invalid_reset");
  const db = await getDb();
  if (input.password === undefined) {
    const account = await resetLinkAccount(db, input.t);
    return account ? json({ valid: true, handle: account.handle_display ?? account.handle }) : deadLink();
  }
  const account = await resetPassword(db, input.t, input.password);
  return jsonWithSession({ authenticated: true, handle: account.handle_display ?? account.handle }, { userId: account.user_id, authenticated: true });
});

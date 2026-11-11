import { after } from "next/server";
import { z } from "zod";
import { FORGOT_ANSWER, FORGOT_LIMITS, requestPasswordReset } from "@/lib/account-recovery";
import { sessionsSignable } from "@/lib/auth";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { handle, isMcpCall, json, parseBody, readJson } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";

const ForgotInput = z.object({ who: z.string("Type your handle or recovery email.").trim().min(3, "Type your handle or recovery email.").max(254) });

/**
 * "Forgot your password?" (lib/account-recovery.ts): a reset link to the recovery email of the account with this handle
 * or address. Always the same answer, and the email goes after it, so neither the answer nor how long it takes says
 * whether there's an account. People only, a few an hour from one connection.
 */
export const POST = handle(async (req: Request) => {
  if (!sessionsSignable()) return json({ error: "accounts_unavailable", message: "Accounts are not enabled on this deployment yet." }, 503);
  if (isMcpCall(req) || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) {
    return json({ error: "people_only", message: "Password resets are for people, in a browser." }, 403);
  }
  const input = parseBody(ForgotInput, await readJson(req), "invalid_forgot");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if (visitor !== null && (await overLimit(db, "password_forgot", visitor, FORGOT_LIMITS))) {
    return json({ error: "rate_limited", message: "Too many tries from here. Try again in an hour." }, 429);
  }
  const send = () =>
    requestPasswordReset(db, input.who).then(
      () => undefined,
      (err: unknown) => console.error("[recovery] reset link failed:", err instanceof Error ? err.message : "unknown"),
    );
  try {
    after(send);
  } catch {
    await send(); // no request scope (a test calling the route directly): send it now
  }
  return json({ ok: true, message: FORGOT_ANSWER });
});

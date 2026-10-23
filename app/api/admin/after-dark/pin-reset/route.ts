import { z } from "zod";
import { RESET_CODE_RE } from "@/lib/adult/discreet";
import { clearUnlockCookie, failedTry, privacyOwner, replyWith, resetWays, resetWithCode, resetWithPassword, sendResetCode } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ code: z.string().max(16).optional(), password: z.string().max(200).optional() }).strict();

/**
 * Forgot the PIN (lib/adult/privacy.ts): only the signed-in owner, and then through the account. An account with a
 * confirmed email gets an 8-digit code there; one without confirms with its password. A right answer takes the PIN off
 * (set a new one in the privacy settings); a wrong one counts as a try, like a wrong PIN. Not found for anyone else.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const owner = await privacyOwner(db, authFromRequest(req));
  if (!owner) return json({ error: "not_found" }, 404);
  return json({ reset: await resetWays(db, owner) });
});

/** {} sends the code; { code } or { password } resets. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const owner = await privacyOwner(db, authFromRequest(req));
  if (!owner) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");

  if (input.code !== undefined) {
    const code = input.code.replace(/\s+/g, "");
    if (!RESET_CODE_RE.test(code)) return json({ error: "invalid_code", message: "The code is the 8 digits in the email." }, 422);
    const a = await resetWithCode(db, owner, code);
    return a.ok ? replyWith({ reset: true }, 200, { cookies: [clearUnlockCookie()] }) : failedTry(a, "code");
  }

  if (input.password !== undefined) {
    const a = await resetWithPassword(db, owner, input.password);
    if (a.ok) return replyWith({ reset: true }, 200, { cookies: [clearUnlockCookie()] });
    if (a.error === "use_email") return json({ error: "use_email", message: "This account has an email: use the code sent there." }, 409);
    if (a.error === "no_password") return json({ error: "no_password", message: "This account has no password to confirm with." }, 409);
    return failedTry(a, "password");
  }

  const sent = await sendResetCode(db, owner);
  return sent.ok ? json({ sent: true, to: sent.to }) : json({ error: sent.error, message: sent.message }, sent.status);
});

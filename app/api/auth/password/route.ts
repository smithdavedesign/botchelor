import { z } from "zod";
import { changePassword } from "@/lib/account-recovery";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { visitorKey } from "@/lib/limits";

const ChangeInput = z.object({
  current: z.string().min(1, "Type your current password.").max(400),
  password: z.string().min(PASSWORD_MIN, `The new password needs at least ${PASSWORD_MIN} characters.`).max(PASSWORD_MAX),
});

/**
 * Change the signed-in account's password (lib/account-recovery.ts): the current one first, and wrong tries count as
 * failed sign-ins. Reset links sent before it stop working, and the recovery email hears about the change.
 */
export const POST = handle(async (req) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "sign_in_required", message: "Sign in to change your password." }, 401);
  const input = parseBody(ChangeInput, await readJson(req), "invalid_password");
  await changePassword(await getDb(), auth.userId, input.current, input.password, visitorKey(req.headers));
  return json({ ok: true });
});

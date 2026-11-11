import { z } from "zod";
import { recoveryStatus, removeRecoveryEmail, setRecoveryEmail } from "@/lib/account-recovery";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { visitorKey } from "@/lib/limits";

const SetInput = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1, "Type your current password.").max(400) });
const RemoveInput = z.object({ password: z.string().min(1, "Type your current password.").max(400) });

const signInFirst = () => json({ error: "sign_in_required", message: "Sign in to your account first." }, 401);

/** The account's recovery email, for the account page (lib/account-recovery.ts). Signed in only: it's the owner's address. */
export const GET = handle(async (req) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return signInFirst();
  return json(await recoveryStatus(await getDb(), auth.userId));
});

/** Adds or changes the recovery email: the current password, then a link to the address (or at once, if already confirmed). */
export const POST = handle(async (req) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return signInFirst();
  const input = parseBody(SetInput, await readJson(req), "invalid_recovery_email");
  return json(await setRecoveryEmail(await getDb(), auth.userId, input.email, input.password, visitorKey(req.headers)));
});

/** Takes the recovery email off, with the current password. The address that was on it hears about it. */
export const DELETE = handle(async (req) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return signInFirst();
  const input = parseBody(RemoveInput, await readJson(req), "invalid_password");
  await removeRecoveryEmail(await getDb(), auth.userId, input.password, visitorKey(req.headers));
  return json({ ok: true });
});

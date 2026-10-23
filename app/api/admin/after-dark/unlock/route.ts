import { z } from "zod";
import { PIN_RE } from "@/lib/adult/discreet";
import { clearUnlockCookie, failedTry, getPrivacy, privacyOwner, replyWith, signUnlock, tryPin, unlockCookie } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ pin: z.string().max(12) });

/**
 * Unlocks After Dark on this device with the account's PIN (lib/adult/privacy.ts): a signed cookie for 12 hours. Only for
 * a signed-in account After Dark is open to; not found for anyone else. Five wrong tries set a 15-minute wait.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const owner = await privacyOwner(db, authFromRequest(req));
  if (!owner) return json({ error: "not_found" }, 404);
  const { pin } = parseBody(Input, await readJson(req), "invalid_request");
  if (!PIN_RE.test(pin)) return json({ error: "invalid_pin", message: "A PIN is 4 to 6 digits." }, 422);
  if (!(await getPrivacy(db, owner)).pin) return json({ unlocked: true });
  const a = await tryPin(db, owner, pin);
  if (!a.ok) return failedTry(a, "PIN");
  const token = signUnlock(owner, a.version);
  if (!token) return json({ error: "unavailable" }, 503);
  return replyWith({ unlocked: true }, 200, { cookies: [unlockCookie(token)] });
});

/** Locks this device again now ("Lock now"): its unlock cookie goes. */
export const DELETE = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await privacyOwner(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  return replyWith({ locked: true }, 200, { cookies: [clearUnlockCookie()] });
});

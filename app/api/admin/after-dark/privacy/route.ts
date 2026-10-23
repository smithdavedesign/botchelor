import { z } from "zod";
import { PIN_RE } from "@/lib/adult/discreet";
import {
  clearPin,
  clearUnlockCookie,
  failedTry,
  getPrivacy,
  lockedForRequest,
  privacyOwner,
  replyWith,
  resetWays,
  savePrivacy,
  setPin,
  signUnlock,
  tryPin,
  unlockCookie,
} from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

const pin = z.string().max(12);
const Input = z
  .object({
    blur: z.boolean().optional(),
    neutral_title: z.boolean().optional(),
    set_pin: pin.optional(),
    remove_pin: z.literal(true).optional(),
    current_pin: pin.optional(),
  })
  .strict();

/** The owner on an unlocked device (lib/adult/privacy.ts), else null: a locked device can't change what locks it. */
async function unlockedOwner(req: Request) {
  const db = await getDb();
  const owner = await privacyOwner(db, authFromRequest(req));
  if (!owner || (await lockedForRequest(db, owner, req))) return { db, owner: null };
  return { db, owner };
}

/** After Dark's privacy settings: blur, the neutral title, and whether there's a PIN (never the PIN). */
export const GET = handle(async (req: Request) => {
  const { db, owner } = await unlockedOwner(req);
  if (!owner) return json({ error: "not_found" }, 404);
  return json({ privacy: await getPrivacy(db, owner), reset: await resetWays(db, owner) });
});

/**
 * Turns blur and the neutral title on or off, and sets, changes or removes the PIN. Changing or removing a PIN takes the
 * current one (a try, counted like any other). A new PIN signs every other device out and unlocks this one.
 */
export const POST = handle(async (req: Request) => {
  const { db, owner } = await unlockedOwner(req);
  if (!owner) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const had = (await getPrivacy(db, owner)).pin;

  if (input.set_pin !== undefined || input.remove_pin) {
    if (input.set_pin !== undefined && !PIN_RE.test(input.set_pin)) return json({ error: "invalid_pin", message: "A PIN is 4 to 6 digits." }, 422);
    if (input.remove_pin && !had) return json({ privacy: await getPrivacy(db, owner) });
    if (had) {
      if (!input.current_pin || !PIN_RE.test(input.current_pin)) return json({ error: "current_pin_needed", message: "Enter your current PIN first." }, 422);
      const a = await tryPin(db, owner, input.current_pin);
      if (!a.ok) return failedTry(a, "PIN");
    }
    if (input.remove_pin) {
      await clearPin(db, owner);
      return replyWith({ privacy: await getPrivacy(db, owner) }, 200, { cookies: [clearUnlockCookie()] });
    }
    const { version } = await setPin(db, owner, input.set_pin!);
    const token = signUnlock(owner, version);
    return replyWith({ privacy: await getPrivacy(db, owner) }, 200, { cookies: token ? [unlockCookie(token)] : [] });
  }

  if (input.blur === undefined && input.neutral_title === undefined) return json({ error: "invalid_request", message: "Nothing to change." }, 422);
  return json({ privacy: await savePrivacy(db, owner, { blur: input.blur, neutral_title: input.neutral_title }) });
});

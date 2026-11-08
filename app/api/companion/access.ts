import { sessionsSignable } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { json, signedIdentity, type Session } from "@/lib/http";
import { companionAllowed } from "@/lib/companion";
import { companionGuestsOpen } from "@/lib/companion-shared";
import { passedAgeGate } from "../step-in/access";

/**
 * A guest (no account) may try companions once they're open to everyone (lib/companion-shared.ts companionGuestsOpen),
 * on a signed identity only: their own signed session, or a new one this response signs. Never on a bare `bz_uid`,
 * which anyone could type in to read someone else's conversation.
 */
export function companionGuest(req: Request, sess: Session): boolean {
  if (sess.authenticated || !companionGuestsOpen()) return false;
  return sess.isNew ? sessionsSignable() : signedIdentity(req);
}

/**
 * Who may talk with a companion (docs/companions.md): signed in (an admin until COMPANION_OPEN=1), or a guest trying it
 * (companionGuest); past the 18+ gate either way. A refusal reads as "not found" to anyone it isn't open to, so it
 * doesn't announce itself.
 */
export async function companionRefusal(db: Db, req: Request, sess: Session): Promise<Response | null> {
  if (!sess.authenticated && !companionGuest(req, sess)) return json({ error: "sign_in", message: "Sign in to talk with a companion." }, 401, sess);
  if (!passedAgeGate(req)) return json({ error: "age_gate", message: "Botchelor is 18+. Confirm your age first." }, 403, sess);
  if (sess.authenticated && !(await companionAllowed(db, sess))) return json({ error: "not_found", message: "Not found." }, 404, sess);
  return null;
}

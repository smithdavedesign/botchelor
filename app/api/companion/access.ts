import type { Db } from "@/lib/db";
import { json, type Session } from "@/lib/http";
import { companionAllowed } from "@/lib/companion";
import { passedAgeGate } from "../step-in/access";

/**
 * Who may talk with a companion (docs/companions.md): signed in, past the 18+ gate, and an admin until COMPANION_OPEN=1.
 * A refusal reads as "not found" to anyone it isn't open to, so it doesn't announce itself.
 */
export async function companionRefusal(db: Db, req: Request, sess: Session): Promise<Response | null> {
  if (!sess.authenticated) return json({ error: "sign_in", message: "Sign in to talk with a companion." }, 401, sess);
  if (!passedAgeGate(req)) return json({ error: "age_gate", message: "Botchelor is 18+. Confirm your age first." }, 403, sess);
  if (!(await companionAllowed(db, sess))) return json({ error: "not_found", message: "Not found." }, 404, sess);
  return null;
}

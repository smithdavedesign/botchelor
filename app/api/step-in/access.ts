import { ADULT_COOKIE } from "@/lib/age";
import type { Db } from "@/lib/db";
import { json, type Session } from "@/lib/http";
import { stepInAllowed } from "@/lib/step-in";

/** The 18+ gate's cookie on this request (the gate itself is the middleware's; an API call carries the same cookie). */
export function passedAgeGate(req: Request): boolean {
  const cookies = req.headers.get("cookie") ?? "";
  return cookies.split(/;\s*/).some((c) => c === `${ADULT_COOKIE}=1`);
}

/**
 * Who may step into a date (docs/step-into-the-date.md): signed in, past the 18+ gate, and an admin until STEP_IN_OPEN=1.
 * A refusal reads as "not found" to anyone the feature isn't open to, so it doesn't announce itself.
 */
export async function stepInRefusal(db: Db, req: Request, sess: Session): Promise<Response | null> {
  if (!sess.authenticated) return json({ error: "sign_in", message: "Sign in to step into a date." }, 401, sess);
  if (!passedAgeGate(req)) return json({ error: "age_gate", message: "Botchelor is 18+. Confirm your age first." }, 403, sess);
  if (!(await stepInAllowed(db, sess))) return json({ error: "not_found", message: "Not found." }, 404, sess);
  return null;
}

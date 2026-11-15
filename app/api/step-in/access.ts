import { ADULT_COOKIE } from "@/lib/age";
import { sessionsSignable } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { json, signedIdentity, type Session } from "@/lib/http";
import { visitorKey } from "@/lib/limits";
import type { StepInWho } from "@/lib/step-in";
import { stepInAccess } from "@/lib/step-in-access";

/** The 18+ gate's cookie on this request (the gate itself is the middleware's; an API call carries the same cookie). */
export function passedAgeGate(req: Request): boolean {
  const cookies = req.headers.get("cookie") ?? "";
  return cookies.split(/;\s*/).some((c) => c === `${ADULT_COOKIE}=1`);
}

export const AGE_REFUSAL = { error: "age_gate", message: "Botchelor is 18+. Confirm you're 18 or over first." } as const;

/**
 * Who may step into a date (lib/step-in-access.ts; docs/step-into-the-date.md): anyone while it's open, a guest on a
 * signed identity; an admin only at STEP_IN_OPEN=0. A refusal to someone it isn't open to reads as "not found", so a
 * closed feature doesn't announce itself. Returns who they are for the caps (a guest, and the address they come from).
 * The 18+ answer is checked by each route: the start takes the start screen's box as well as the gate's cookie.
 */
export async function stepInWho(db: Db, req: Request, sess: Session): Promise<{ refused: Response } | { who: StepInWho }> {
  const access = await stepInAccess(db, sess, sess.isNew ? sessionsSignable() : signedIdentity(req));
  if (!access) return { refused: json({ error: "not_found", message: "Not found." }, 404, sess) };
  if (access.kind === "sign_in") {
    return { refused: json({ error: "sign_in", message: "Sign in to step into a date.", next: [{ href: "/account?next=%2Fstep-in", label: "Sign in", track: "step-in-signin" }] }, 401, sess) };
  }
  return { who: { guest: access.kind === "guest", ip: visitorKey(req.headers) } };
}

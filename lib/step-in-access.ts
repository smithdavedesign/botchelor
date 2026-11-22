/**
 * Who may step into a date (lib/step-in.ts), read from an identity: the API's check (app/api/step-in/access.ts) and the
 * pages' (from their cookie store) are this one rule.
 *  - Someone signed in: a member while it's open (the default), an admin when STEP_IN_OPEN=0.
 *  - Someone without an account: a guest while guests are open (STEP_IN_GUESTS), on a signed identity only (their own
 *    signed session, or none yet: their first start signs one), never a bare `bz_uid` anyone could type in to read
 *    someone else's date. Otherwise they're asked to sign in.
 *  - Nobody else: it reads as not found, so a closed feature doesn't announce itself.
 * The 18+ answer is separate (the gate's cookie, or the start screen's box: app/api/step-in/route.ts).
 */
import { sessionsSignable } from "./auth";
import type { Db } from "./db";
import { type Auth, signedIdentityFromCookieStore } from "./http";
import { stepInAllowed, stepInGuestsOpen, stepInOpen } from "./step-in";

export type StepInAccess =
  | { kind: "member"; userId: string }
  /** `userId` null: no identity yet (a first visit). */
  | { kind: "guest"; userId: string | null }
  | { kind: "sign_in" }
  | null;

/** `signed`: the identity is a signed session, or there's none yet and this app can sign one. */
export async function stepInAccess(db: Db, auth: Auth | null | undefined, signed: boolean, env: Record<string, string | undefined> = process.env): Promise<StepInAccess> {
  if (auth?.authenticated) return (await stepInAllowed(db, auth, env)) ? { kind: "member", userId: auth.userId } : null;
  if (!stepInOpen(env)) return null;
  return stepInGuestsOpen(env) && signed ? { kind: "guest", userId: auth?.userId ?? null } : { kind: "sign_in" };
}

type Store = { get(name: string): { value: string } | undefined };

/** stepInAccess for a page, from its cookies. */
export function stepInAccessFromCookies(db: Db, auth: Auth | null, store: Store): Promise<StepInAccess> {
  return stepInAccess(db, auth, auth ? signedIdentityFromCookieStore(store) : sessionsSignable());
}

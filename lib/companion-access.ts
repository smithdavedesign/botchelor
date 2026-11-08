/**
 * Who may use companions, read from a page's cookies (the API's own check is app/api/companion/access.ts): someone signed
 * in that companions are open to (lib/companion.ts companionAllowed), or a guest trying them (lib/companion-shared.ts
 * companionGuestsOpen) on a signed identity only, never a bare `bz_uid` anyone could type in.
 */
import { sessionsSignable } from "./auth";
import { companionAllowed } from "./companion";
import { companionGuestsOpen } from "./companion-shared";
import type { Db } from "./db";
import { type Auth, signedIdentityFromCookieStore } from "./http";

type Store = { get(name: string): { value: string } | undefined };

export type CompanionAccess = { userId: string; guest: boolean } | null;

export async function companionAccessFromCookies(db: Db, auth: Auth | null, store: Store): Promise<CompanionAccess> {
  if (!auth) return null;
  if (auth.authenticated) return (await companionAllowed(db, auth)) ? { userId: auth.userId, guest: false } : null;
  return companionGuestsOpen() && signedIdentityFromCookieStore(store) ? { userId: auth.userId, guest: true } : null;
}

/** A visitor without an account who may try companions as a guest: on their signed identity, or none yet (their first
 *  Talk makes a signed one). */
export function companionGuestFromCookies(auth: Auth | null, store: Store): boolean {
  if (auth?.authenticated || !companionGuestsOpen()) return false;
  return auth ? signedIdentityFromCookieStore(store) : sessionsSignable();
}

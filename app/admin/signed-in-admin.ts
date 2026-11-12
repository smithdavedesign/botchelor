import { cookies } from "next/headers";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";

/**
 * Whether this visitor is signed in to an admin account (lib/admins.ts), read on the server so an admin page knows
 * without asking an admin API first. That ask used to be the only way, and a signed-out visit logged a 403 for it.
 */
export async function signedInAdmin(): Promise<boolean> {
  const auth = authFromCookieStore(await cookies());
  if (!auth?.authenticated) return false;
  return isSignedInAdmin(await getDb(), auth).catch(() => false);
}

/**
 * Failed sign-ins, counted (2026-11-10 company pass: the password sign-in had no limit, so a script could guess a
 * handle's password as fast as scrypt answers). Only failures count: a person signing in again and again is never held
 * back, and a stranger hammering a handle can't hold it for long either, because the hold lifts LOGIN_WINDOW_MINUTES
 * after the last failure. Two keys, so neither one person guessing many handles nor many places guessing one handle
 * gets far:
 *  - the handle: LOGIN_FAILS_PER_HANDLE failures in the window holds that handle's password sign-in (Google sign-in
 *    still works, and so does the right password once the window passes);
 *  - the visitor (an HMAC of the IP, lib/limits.ts visitorKey): LOGIN_FAILS_PER_VISITOR failures across any handles.
 * Rows go in rate_hits like the other limits, and the daily job prunes them (lib/limits.ts pruneRateHits).
 */
import type { Db } from "./db";

export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_FAILS_PER_HANDLE = 10;
export const LOGIN_FAILS_PER_VISITOR = 30;

const HANDLE_BUCKET = "login_fail_handle";
const VISITOR_BUCKET = "login_fail_visitor";

/** The handle as a key: lowercased and trimmed, so "Ann" and "ann " are one handle. */
const handleKey = (handle: string) => handle.trim().toLowerCase();

/** Whether password sign-in is held for this handle or this visitor right now. */
export async function loginHeld(db: Db, handle: string, visitor: string | null, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { rows } = await db.query<{ handle: number; visitor: number }>(
    `select count(*) filter (where bucket = $1 and key = $2)::int as handle,
            count(*) filter (where bucket = $3 and key = $4)::int as visitor
       from rate_hits
      where at > $5 and ((bucket = $1 and key = $2) or (bucket = $3 and key = $4))`,
    [HANDLE_BUCKET, handleKey(handle), VISITOR_BUCKET, visitor ?? "", since],
  );
  const n = rows[0] ?? { handle: 0, visitor: 0 };
  return n.handle >= LOGIN_FAILS_PER_HANDLE || (visitor !== null && n.visitor >= LOGIN_FAILS_PER_VISITOR);
}

/** Counts one failed sign-in against the handle and the visitor. */
export async function recordLoginFailure(db: Db, handle: string, visitor: string | null, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await db.query("insert into rate_hits (bucket, key, at) values ($1, $2, $3)", [HANDLE_BUCKET, handleKey(handle), at]);
  if (visitor) await db.query("insert into rate_hits (bucket, key, at) values ($1, $2, $3)", [VISITOR_BUCKET, visitor, at]);
}

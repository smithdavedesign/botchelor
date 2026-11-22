/**
 * Ending sessions that were already handed out (the 2026-11-22 audit: a session outlived its sign-out, a password change
 * and the account's deletion). A session is a signed token (lib/auth.ts) and nothing is stored per session, so an
 * account has a session version instead: each token carries the version it was signed with (none: 0), and a token below
 * its account's version is refused. Changing the password (lib/account-recovery.ts), deleting the account (app/api/me)
 * and "Sign out everywhere" (app/api/auth/logout) move it up by one; an ordinary sign-out ends only this browser's.
 *
 * Checking a token reads no database. Only an account that ever moved its version has a row, and each process keeps
 * them in memory: loaded with getDb (lib/db.ts) at most once a minute, and moved here at once when this process moves
 * one, so another process notices within the minute. Signing in reads the account's version first
 * (freshSessionVersion): a token signed with an old copy would be refused a minute later.
 */
import type { Db } from "./db";

/** How long a process trusts the versions it loaded before loading what changed since. */
export const SESSION_VERSIONS_FRESH_MS = 60_000;

type Versions = { byUser: Map<string, number>; loadedAt: number; loaded: boolean; cursor: number | null };

// On globalThis, so every copy of this module a bundle makes (pages, routes) reads the same versions.
const KEY = Symbol.for("botchelor.sessionVersions");
const state = ((globalThis as Record<symbol, unknown>)[KEY] ??= { byUser: new Map(), loadedAt: 0, loaded: false, cursor: null }) as Versions;

/** A version only ever goes up, whichever copy of it arrives first. */
function note(userId: string, version: number): void {
  if (Number.isFinite(version) && version > (state.byUser.get(userId) ?? 0)) state.byUser.set(userId, version);
}

/** The session version this process knows for a user id: 0 when it never moved. */
export function knownSessionVersion(userId: string): number {
  return state.byUser.get(userId) ?? 0;
}

/** Whether this process has loaded the versions at least once. */
export const sessionVersionsLoaded = (): boolean => state.loaded;

/**
 * Loads the versions that changed since the last load (all of them the first time), unless this process loaded them in
 * the last minute. The window looks five minutes back from the newest change it has seen, so a row written just before
 * a load isn't missed.
 */
export async function refreshSessionVersions(db: Db, now = Date.now()): Promise<void> {
  if (now - state.loadedAt < SESSION_VERSIONS_FRESH_MS) return;
  state.loadedAt = now;
  const since = state.cursor;
  const { rows } = await db.query<{ user_id: string; version: number; at: number }>(
    `select user_id, version, extract(epoch from changed_at)::float8 as at from session_versions` +
      (since === null ? "" : ` where changed_at > to_timestamp($1::float8) - interval '5 minutes'`),
    since === null ? [] : [since],
  );
  for (const r of rows) {
    note(r.user_id, Number(r.version));
    state.cursor = Math.max(state.cursor ?? 0, Number(r.at));
  }
  state.loaded = true;
}

/** Reads one account's version from the database (before signing it in) and returns it. */
export async function freshSessionVersion(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>(`select version from session_versions where user_id = $1`, [userId]);
  if (rows[0]) note(userId, Number(rows[0].version));
  return knownSessionVersion(userId);
}

/** Ends every session this account has handed out: its version moves up by one, here at once. Returns the new version. */
export async function bumpSessionVersion(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>(
    `insert into session_versions (user_id, version, changed_at) values ($1, 1, now())
       on conflict (user_id) do update set version = session_versions.version + 1, changed_at = now()
     returning version`,
    [userId],
  );
  note(userId, Number(rows[0]?.version ?? 0));
  return knownSessionVersion(userId);
}

/** Tests start from nothing known. */
export function forgetSessionVersionsForTests(): void {
  state.byUser.clear();
  state.loadedAt = 0;
  state.loaded = false;
  state.cursor = null;
}

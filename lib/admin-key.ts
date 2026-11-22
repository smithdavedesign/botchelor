/**
 * Guessing the admin key (x-frontier-key, checked by lib/model.ts frontierAuthorized) is limited (2026-11-22 audit: the
 * guesses were unlimited). An address (lib/limits.ts clientIp; an IPv6 /64 counts as one) that sends
 * ADMIN_KEY_FAILURES_ALLOWED wrong keys within ADMIN_KEY_WINDOW_MS has every key refused, the right one too, for the
 * next ADMIN_KEY_LOCKOUT_MS. A right key clears the count.
 *
 * Only the key is refused: a signed-in admin account (lib/admin-auth.ts adminAuthorized) never reads it, so the owner
 * is never locked out. Each process counts in its own memory: no database read on any request, and a restart forgets.
 * A request with no address (the server's own in-process calls, tests) isn't counted.
 */
import { clientIp, visitorAddress } from "./limits";

export const ADMIN_KEY_FAILURES_ALLOWED = 10;
export const ADMIN_KEY_WINDOW_MS = 15 * 60_000;
export const ADMIN_KEY_LOCKOUT_MS = 15 * 60_000;
/** Past this many addresses, the ones with nothing left to remember are dropped. */
const MAX_ADDRESSES = 5000;

type Entry = { failures: number[]; lockedUntil: number };

// On globalThis, so every copy of this module a bundle makes (routes, the MCP endpoint) counts the same guesses.
const KEY = Symbol.for("botchelor.adminKeyFailures");
const byAddress = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map<string, Entry>()) as Map<string, Entry>;
/** A request already counted: one request can check the key more than once (adminAuthorized, then the route). */
const counted = new WeakSet<Request>();

function sweep(now: number): void {
  for (const [address, e] of byAddress) {
    if (e.lockedUntil <= now && !e.failures.some((t) => now - t < ADMIN_KEY_WINDOW_MS)) byAddress.delete(address);
  }
}

/**
 * Whether a key check may pass: `matches` is whether the key sent was the right one. False while the request's address
 * is locked out; a wrong key counts towards it.
 */
export function adminKeyAllowed(req: Request, matches: boolean, now = Date.now()): boolean {
  const ip = clientIp(req.headers);
  if (!ip) return matches;
  const address = visitorAddress(ip);
  const entry = byAddress.get(address);
  if (entry && entry.lockedUntil > now) return false;
  if (matches) {
    byAddress.delete(address);
    return true;
  }
  if (counted.has(req)) return false;
  counted.add(req);
  const failures = [...(entry?.failures ?? []).filter((t) => now - t < ADMIN_KEY_WINDOW_MS), now];
  if (failures.length >= ADMIN_KEY_FAILURES_ALLOWED) {
    byAddress.set(address, { failures: [], lockedUntil: now + ADMIN_KEY_LOCKOUT_MS });
    // No address in the log: it's someone's. The owner's way in, a signed-in admin account, isn't affected.
    console.warn(`[admin-key] ${ADMIN_KEY_FAILURES_ALLOWED} wrong admin keys from one address: its keys are refused for ${ADMIN_KEY_LOCKOUT_MS / 60_000} minutes`);
  } else {
    byAddress.set(address, { failures, lockedUntil: 0 });
  }
  if (byAddress.size > MAX_ADDRESSES) sweep(now);
  return false;
}

/** Tests start from nothing counted. */
export function forgetAdminKeyFailuresForTests(): void {
  byAddress.clear();
}

/**
 * The 18+ entry gate's shared bits (edge-safe: consts and pure functions, so middleware can import them).
 * Botchelor is a fictional 18+ show; the gate is a self-attestation remembered in this cookie for a year.
 *
 * Since 2026-11-14 (David's call) the PG show pages (home, Watch, episodes, seasons, characters, the builder) are open
 * without it, and the attestation happens where it matters: the gate still fronts the dating, chat and money surfaces,
 * and the builder's "I'm 18+" checkbox sets this same cookie when a character is saved (app/api/characters/route.ts),
 * so a creator never meets the gate afterwards.
 */
export const ADULT_COOKIE = "bz_adult";

/** How long the answer is remembered: a year, the same wherever the cookie is set. */
export const ADULT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The Set-Cookie line every server route uses to remember the answer (the gate's confirm, the sign-in hop, a saved
 * character). `secure` is the caller's call: /api/age goes by the request's protocol, so a local http deployment
 * doesn't loop the gate; lib/http's identity cookies go by NODE_ENV.
 */
export function adultCookie(secure: boolean): string {
  return `${ADULT_COOKIE}=1; Path=/; Max-Age=${ADULT_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Whether a request's Cookie header carries the answer (for routes without a NextRequest's parsed cookies). */
export function hasAdultCookie(cookieHeader: string | null | undefined): boolean {
  return (cookieHeader ?? "").split(";").some((c) => c.trim() === `${ADULT_COOKIE}=1`);
}

/**
 * A safe same-origin path to return to after confirming: local only (no host/protocol), never a gate loop. A
 * backslash or control character is refused too: browsers read "/\evil.example" as "//evil.example".
 */
export function safeFrom(from: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex -- control characters are what it refuses
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/gate") || /[\\\u0000-\u001f]/.test(from)) return "/";
  return from;
}

/**
 * The 18+ entry gate's shared bits (edge-safe: a const and a pure function, so middleware can import them).
 * Botchelor is a fictional 18+ show; the gate is a self-attestation remembered in this cookie for a year.
 */
export const ADULT_COOKIE = "bz_adult";

/**
 * A safe same-origin path to return to after confirming: local only (no host/protocol), never a gate loop. A
 * backslash or control character is refused too: browsers read "/\evil.example" as "//evil.example".
 */
export function safeFrom(from: string | null | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/gate") || /[\\\u0000-\u001f]/.test(from)) return "/";
  return from;
}

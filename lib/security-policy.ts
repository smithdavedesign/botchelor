/**
 * The security policy's machine-readable side (RFC 9116): /.well-known/security.txt, which points a researcher who
 * finds a hole at security@ (and the support address) and at /security, the policy in words. Expires is required and must be under a
 * year away, so it's written per request, 180 days out: the file can never go stale. Pure.
 */
import { roleEmail } from "./company";
import { contactEmail } from "./legal-entity";

type Env = Record<string, string | undefined>;

/** How far ahead the file's Expires field sits. */
export const SECURITY_TXT_DAYS = 180;

/** The file's text, or null when no support address is set (a security.txt must name a contact). */
export function securityTxt(base: string, env: Env = process.env, now: Date = new Date()): string | null {
  const email = contactEmail(env);
  if (!email) return null;
  const expires = new Date(now.getTime() + SECURITY_TXT_DAYS * 24 * 60 * 60 * 1000);
  expires.setUTCHours(0, 0, 0, 0);
  // security@ first (it forwards to the same inbox), then the support address as a fallback.
  const security = roleEmail("security", env);
  return [
    ...(security && security !== email ? [`Contact: mailto:${security}`] : []),
    `Contact: mailto:${email}`,
    `Expires: ${expires.toISOString()}`,
    `Policy: ${base}/security`,
    `Canonical: ${base}/.well-known/security.txt`,
    "Preferred-Languages: en",
    "",
  ].join("\n");
}

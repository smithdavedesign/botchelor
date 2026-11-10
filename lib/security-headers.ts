/**
 * The headers every response carries (next.config.ts; 2026-11-10 company pass: the live site sent none). Each one is
 * safe for every route here:
 *  - HSTS: browsers that have been here once never try plain http again. No includeSubDomains: the mail subdomains point
 *    at Resend, and a subdomain someone else serves isn't ours to force onto https. No preload either: that list is hard
 *    to leave.
 *  - nosniff: a file is only ever read as the type we sent.
 *  - frame-ancestors 'self' (and X-Frame-Options for older browsers): another site can't put the show in a frame and
 *    trick a click. Nothing here frames another host's page, or is framed by one.
 *  - Referrer-Policy: another site learns only that a visitor came from botchelor.com, never the page.
 * Not here: a full Content-Security-Policy (the Google tags, Stripe and inline scripts need a nonce plan first) and
 * Permissions-Policy (live calls use the microphone, and the age check the camera).
 */
export const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

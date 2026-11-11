/**
 * /.well-known/change-password (the W3C "well-known URL for changing passwords"): password managers send people here to
 * change a saved password, and it points at the form on the account page.
 */
export function GET(): Response {
  return new Response(null, { status: 302, headers: { location: "/account#password", "cache-control": "public, max-age=86400" } });
}

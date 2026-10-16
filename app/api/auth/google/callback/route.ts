import { safeFrom } from "@/lib/age";
import { exchangeGoogleCode, googleConfigured, loginWithGoogle, oauthRedirectUri, verifyOAuthState } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, sessionCookies } from "@/lib/http";

function redirect(path: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: path });
  for (const c of cookies) headers.append("set-cookie", c);
  // Drop the one-shot OAuth state cookie and the destination.
  headers.append("set-cookie", `bz_oauth=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`);
  headers.append("set-cookie", `bz_next=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}

/** Where /start said to go once signed in (the bz_next cookie), as a local path, or null. */
function nextPath(req: Request): string | null {
  const raw = (req.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith("bz_next="))?.slice("bz_next=".length);
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const path = safeFrom(decoded);
  return path === "/" ? null : path;
}

/**
 * Google redirects here with a code. Verify the state, exchange the code, then sign the user in and go where
 * /start was asked to (else the account page). A failure goes to the account page, keeping that destination.
 */
export const GET = handle(async (req) => {
  const next = nextPath(req);
  const failed = (error: string) => redirect(`/account?error=${error}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  if (!googleConfigured()) return failed("google_unavailable");
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // CSRF: the state must match the one we set on /start and be correctly signed.
  const stateCookie = (req.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith("bz_oauth="));
  const cookieState = stateCookie?.slice("bz_oauth=".length);
  if (!code || !state || state !== cookieState || !verifyOAuthState(state)) return failed("oauth_state");

  try {
    const identity = await exchangeGoogleCode(code, oauthRedirectUri(req));
    const current = authFromRequest(req)?.userId ?? crypto.randomUUID();
    const userId = await loginWithGoogle(await getDb(), current, identity.sub, identity.email);
    return redirect(next ?? "/account?signed_in=1", sessionCookies({ userId, authenticated: true }));
  } catch {
    return failed("google_failed");
  }
});

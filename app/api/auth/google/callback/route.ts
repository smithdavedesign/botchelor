import { exchangeGoogleCode, googleConfigured, loginWithGoogle, verifyOAuthState } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, sessionCookies } from "@/lib/http";

function redirect(path: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: path });
  for (const c of cookies) headers.append("set-cookie", c);
  // Drop the one-shot OAuth state cookie.
  headers.append("set-cookie", `bz_oauth=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}

/** Google redirects here with a code. Verify the state, exchange the code, then sign the user in. */
export const GET = handle(async (req) => {
  if (!googleConfigured()) return redirect("/account?error=google_unavailable");
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // CSRF: the state must match the one we set on /start and be correctly signed.
  const stateCookie = (req.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith("bz_oauth="));
  const cookieState = stateCookie?.slice("bz_oauth=".length);
  if (!code || !state || state !== cookieState || !verifyOAuthState(state)) return redirect("/account?error=oauth_state");

  try {
    const identity = await exchangeGoogleCode(code, `${url.origin}/api/auth/google/callback`);
    const current = authFromRequest(req)?.userId ?? crypto.randomUUID();
    const userId = await loginWithGoogle(await getDb(), current, identity.sub, identity.email);
    return redirect("/account?signed_in=1", sessionCookies({ userId, authenticated: true }));
  } catch {
    return redirect("/account?error=google_failed");
  }
});

import { randomUUID } from "node:crypto";
import { googleConfigured, oauthRedirectUri, signOAuthState } from "@/lib/auth";
import { handle, json } from "@/lib/http";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";

/** Begin Google sign-in: set a signed state cookie and redirect to Google's consent screen. */
export const GET = handle(async (req) => {
  if (!googleConfigured()) return json({ error: "google_unavailable", message: "Google sign-in is not enabled on this deployment." }, 503);
  // The state cookie must be set on the host Google sends the browser back to, or the callback can't see it (and
  // fails "oauth_state"). Sign-in started on another of our hosts (botchelor.vercel.app once botchelor.com is
  // canonical) hops there first; `hop` stops a loop if the two ever disagree about the host.
  const callback = new URL(oauthRedirectUri(req));
  const here = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? here.host;
  if (host !== callback.host && !here.searchParams.has("hop")) {
    return new Response(null, { status: 302, headers: { location: `${callback.origin}/api/auth/google/start?hop=1` } });
  }
  const nonce = randomUUID();
  const state = signOAuthState(nonce);
  if (!state) return json({ error: "accounts_unavailable" }, 503);

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: oauthRedirectUri(req),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      location: `${GOOGLE_AUTH}?${params}`,
      "set-cookie": `bz_oauth=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
    },
  });
});

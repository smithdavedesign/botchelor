import { randomUUID } from "node:crypto";
import { googleConfigured, signOAuthState } from "@/lib/auth";
import { handle, json } from "@/lib/http";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";

/** Begin Google sign-in: set a signed state cookie and redirect to Google's consent screen. */
export const GET = handle(async (req) => {
  if (!googleConfigured()) return json({ error: "google_unavailable", message: "Google sign-in is not enabled on this deployment." }, 503);
  const nonce = randomUUID();
  const state = signOAuthState(nonce);
  if (!state) return json({ error: "accounts_unavailable" }, 503);

  const origin = new URL(req.url).origin;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: `${origin}/api/auth/google/callback`,
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

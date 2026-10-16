import { ADULT_COOKIE, safeFrom } from "@/lib/age";
import { signCarry, verifyCarry } from "@/lib/auth";
import { authFromRequest, handle, sessionCookies } from "@/lib/http";
import { siteUrl } from "@/lib/site";

const ONE_YEAR = 60 * 60 * 24 * 365;

const redirect = (location: string, cookies: string[] = []): Response => {
  const headers = new Headers({ location, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
};

const hasAdultCookie = (req: Request): boolean => new RegExp(`(?:^|;\\s*)${ADULT_COOKIE}=1(?:;|$)`).test(req.headers.get("cookie") ?? "");

/**
 * Moves a returning player from the old host to the canonical one without losing who they are. Cookies are per
 * host, so a player whose characters hang off a `bz_sess`/`bz_uid` cookie on botchelor.vercel.app would land on
 * botchelor.com as a stranger. The middleware sends page visits on the old host that carry an identity here.
 *  - On the old host (no `t`): sign this browser's identity into a one-minute carry token and send it on.
 *  - On the canonical host (`t`): set that identity, and the 18+ confirmation, unless this browser already has an
 *    identity there (an existing one is never replaced), then go where they were headed.
 */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const to = safeFrom(url.searchParams.get("to"));
  const canonical = siteUrl();
  const token = url.searchParams.get("t");

  if (token === null) {
    const auth = authFromRequest(req);
    const carry = auth ? signCarry({ uid: auth.userId, authenticated: auth.authenticated, adult: hasAdultCookie(req) }) : null;
    if (!carry) return redirect(`${canonical}${to}`);
    return redirect(`${canonical}/api/auth/carry?${new URLSearchParams({ t: carry, to })}`);
  }

  const claims = verifyCarry(token);
  const cookies: string[] = [];
  if (claims && !authFromRequest(req)) {
    cookies.push(...sessionCookies({ userId: claims.uid, authenticated: claims.authenticated }));
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    if (claims.adult) cookies.push(`${ADULT_COOKIE}=1; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax${secure}`);
  }
  return redirect(to, cookies);
});

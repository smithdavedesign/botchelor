import { ADULT_COOKIE, safeFrom } from "@/lib/age";
import { isCarryNonce, newCarryNonce, signCarry, verifyCarry } from "@/lib/auth";
import { authFromRequest, handle, safeEqual, sessionCookies } from "@/lib/http";
import { OLD_HOSTS, requestHost, siteUrl } from "@/lib/site";

const ONE_YEAR = 60 * 60 * 24 * 365;
/** The receiving browser's nonce: botchelor.com only, this route only, gone in five minutes or once used. */
const NONCE_COOKIE = "bz_carry";
const NONCE_TTL = 5 * 60;

const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");
const nonceCookie = (value: string, maxAge: number) => `${NONCE_COOKIE}=${value}; Path=/api/auth/carry; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure()}`;

const redirect = (location: string, cookies: string[] = []): Response => {
  const headers = new Headers({ location, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
};

const cookie = (req: Request, name: string): string | undefined =>
  new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(req.headers.get("cookie") ?? "")?.[1];

/**
 * Moves a returning player from the old host to the canonical one without losing who they are. Cookies are per
 * host, so a player whose characters hang off a `bz_sess`/`bz_uid` cookie on botchelor.vercel.app would land on
 * botchelor.com as a stranger. The middleware sends page visits on the old host that carry an identity here.
 *
 * The handshake starts on botchelor.com so the token is bound to the browser that receives it:
 *  1. Old host, no params: go to botchelor.com, saying which old host we came from.
 *  2. botchelor.com, `from`: unless this browser already has an identity here (an existing one is never replaced),
 *     put a random nonce in a cookie and send the browser back to that old host with it (`n`).
 *  3. Old host, `n`: sign this browser's identity and 18+ confirmation, with the nonce, into a one-minute token (`t`).
 *  4. botchelor.com, `t`: set that identity only if the token's nonce is this browser's own cookie, then go where
 *     they were headed. A token minted for anyone else's browser (an attacker handing out their own identity, or a
 *     victim's fixed one) carries a nonce this browser never had, so it sets nothing.
 */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const to = safeFrom(url.searchParams.get("to"));
  const canonical = siteUrl();
  const host = requestHost(req);
  const onOldHost = OLD_HOSTS.has(host) && new URL(canonical).host !== host; // never a loop onto itself

  const token = url.searchParams.get("t");
  if (token !== null) {
    const claims = verifyCarry(token);
    const mine = cookie(req, NONCE_COOKIE);
    const cookies = [nonceCookie("", 0)];
    if (claims && isCarryNonce(mine) && safeEqual(claims.nonce, mine) && !authFromRequest(req)) {
      cookies.push(...sessionCookies({ userId: claims.uid, authenticated: claims.authenticated }));
      if (claims.adult) cookies.push(`${ADULT_COOKIE}=1; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax${secure()}`);
    }
    return redirect(to, cookies);
  }

  const nonce = url.searchParams.get("n");
  if (nonce !== null) {
    const auth = onOldHost && isCarryNonce(nonce) ? authFromRequest(req) : null;
    const adult = cookie(req, ADULT_COOKIE) === "1";
    const carry = auth ? signCarry({ uid: auth.userId, authenticated: auth.authenticated, adult, nonce }) : null;
    if (!carry) return redirect(`${canonical}${to}`);
    return redirect(`${canonical}/api/auth/carry?${new URLSearchParams({ t: carry, to })}`);
  }

  if (onOldHost) return redirect(`${canonical}/api/auth/carry?${new URLSearchParams({ from: host, to })}`);

  const from = url.searchParams.get("from") ?? "";
  if (!OLD_HOSTS.has(from) || authFromRequest(req)) return redirect(to);
  const fresh = newCarryNonce();
  return redirect(`https://${from}/api/auth/carry?${new URLSearchParams({ n: fresh, to })}`, [nonceCookie(fresh, NONCE_TTL)]);
});

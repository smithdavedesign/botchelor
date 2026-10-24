import { afterDarkElsewhere, afterDarkOnly } from "@/lib/after-dark-host";
import { ADULT_COOKIE, safeFrom } from "@/lib/age";
import { isCarryNonce, newCarryNonce, signCarry, verifyCarry } from "@/lib/auth";
import { authFromRequest, handle, safeEqual, sessionCookies } from "@/lib/http";
import { placeCookie, requestPlace, signPlace, verifyPlace, PLACE_TRIED_COOKIE } from "@/lib/place";
import { OLD_HOSTS, requestHost, siteUrl } from "@/lib/site";

const ONE_YEAR = 60 * 60 * 24 * 365;
/** The receiving browser's nonce: on the receiving host only, this route only, gone in five minutes or once used. */
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
 *
 * After Dark on a host of its own (lib/after-dark-host.ts; off unless AFTER_DARK_ORIGIN is set) uses the same
 * handshake, with After Dark's host receiving and botchelor.com handing on. Every way in from the show (its links, and
 * its redirects of After Dark's pages) starts at step 2 on After Dark's host, which always asks the show (it has no
 * sign-in of its own, so it follows the show's: signing in, out or as someone else there carries over on the way in).
 * botchelor.com mints only for that one configured address, and the nonce binds each token to the browser it was
 * minted for, exactly as above.
 */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const to = safeFrom(url.searchParams.get("to"));
  const canonical = siteUrl();
  const host = requestHost(req);
  const onOldHost = OLD_HOSTS.has(host) && new URL(canonical).host !== host; // never a loop onto itself
  // After Dark's own host receives; botchelor.com, with After Dark moved out, hands on to it (and only to it).
  const afterDarkHost = afterDarkOnly();
  const elsewhere = afterDarkElsewhere();
  const toAfterDark = elsewhere && host === new URL(canonical).host ? elsewhere : null;

  // After Dark's host keeps where the visitor is from the show's signed word (lib/place.ts), for After Dark's regional
  // rules (lib/jurisdiction.ts): only with this browser's own nonce, like the identity.
  const placeFrom = (mine: string | undefined): string[] => {
    if (!afterDarkHost) return [];
    const where = isCarryNonce(mine) ? verifyPlace(url.searchParams.get("pl"), process.env, Date.now(), mine) : null;
    const set = where ? placeCookie(where) : null;
    return [`${PLACE_TRIED_COOKIE}=1; Path=/; Max-Age=60; HttpOnly; SameSite=Lax${secure()}`, ...(set ? [set] : [])];
  };

  const token = url.searchParams.get("t");
  if (token !== null) {
    const claims = verifyCarry(token);
    const mine = cookie(req, NONCE_COOKIE);
    const cookies = [nonceCookie("", 0), ...placeFrom(mine)];
    // botchelor.com never replaces an identity it has; After Dark's host takes the show's, which is the one that counts.
    if (claims && isCarryNonce(mine) && safeEqual(claims.nonce, mine) && (afterDarkHost || !authFromRequest(req))) {
      cookies.push(...sessionCookies({ userId: claims.uid, authenticated: claims.authenticated }));
      if (claims.adult) cookies.push(`${ADULT_COOKIE}=1; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax${secure()}`);
    }
    return redirect(to, cookies);
  }

  // Only a place, for a visitor with no identity to bring (After Dark's subscribe page still needs to know where they are).
  if (url.searchParams.get("pl") !== null) {
    const mine = cookie(req, NONCE_COOKIE);
    return redirect(to, [nonceCookie("", 0), ...placeFrom(mine)]);
  }

  const nonce = url.searchParams.get("n");
  if (nonce !== null) {
    const target = onOldHost ? canonical : toAfterDark;
    const auth = target && isCarryNonce(nonce) ? authFromRequest(req) : null;
    const adult = cookie(req, ADULT_COOKIE) === "1";
    const carry = auth ? signCarry({ uid: auth.userId, authenticated: auth.authenticated, adult, nonce }) : null;
    // To After Dark's host, where this browser connects from, read from the show's (Vercel's) headers and bound to the nonce.
    const pl = toAfterDark && target === toAfterDark && isCarryNonce(nonce) ? signPlace(requestPlace(req.headers), process.env, Date.now(), nonce) : null;
    if (!carry) return pl ? redirect(`${target}/api/auth/carry?${new URLSearchParams({ pl, to })}`) : redirect(`${target ?? canonical}${to}`);
    return redirect(`${target}/api/auth/carry?${new URLSearchParams({ t: carry, ...(pl ? { pl } : {}), to })}`);
  }

  if (onOldHost) return redirect(`${canonical}/api/auth/carry?${new URLSearchParams({ from: host, to })}`);

  if (afterDarkHost) {
    const fresh = newCarryNonce();
    return redirect(`${canonical}/api/auth/carry?${new URLSearchParams({ n: fresh, to })}`, [nonceCookie(fresh, NONCE_TTL)]);
  }

  const from = url.searchParams.get("from") ?? "";
  if (!OLD_HOSTS.has(from) || authFromRequest(req)) return redirect(to);
  const fresh = newCarryNonce();
  return redirect(`https://${from}/api/auth/carry?${new URLSearchParams({ n: fresh, to })}`, [nonceCookie(fresh, NONCE_TTL)]);
});

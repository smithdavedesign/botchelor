/**
 * Where a request comes from, for After Dark's regional rules (lib/jurisdiction.ts).
 *
 * On Vercel (the show) the edge sets x-vercel-ip-country and x-vercel-ip-country-region from the connection, and a
 * client can't override them, so those are read directly. Anywhere else (After Dark's own host on DigitalOcean,
 * docs/after-dark-hosting.md) no header is trusted, since a client could send one: the place comes from `bz_place`, a
 * cookie the show signs on the way in (the sign-in hop, app/api/auth/carry) and the middleware renews by sending the
 * visitor through the hop again once it's an hour old. No place, or an unsigned or stale one, reads as unknown, and an
 * unknown place is blocked.
 *
 * Nothing about the place is stored with the person beyond this cookie and After Dark's last-seen mode
 * (lib/adult/place.ts), which keeps a country and a state, never an address or an IP.
 */
import { createHmac } from "node:crypto";
import { safeEqual } from "./http";
import { place, PLACE_COOKIE, type Place } from "./jurisdiction";

export { PLACE_COOKIE, PLACE_TRIED_COOKIE } from "./jurisdiction";
/** How long a signed place lasts before the visitor goes through the hop again. */
export const PLACE_TTL_SECONDS = 60 * 60;

type Env = Record<string, string | undefined>;
const secretOf = (env: Env): string | null => env.SESSION_SECRET || null;
/** `bind`: the hop's nonce, so a place handed across in a URL only counts in the browser it was minted for. */
const sig = (secret: string, payload: string, bind = ""): string => createHmac("sha256", secret).update(`place:${payload}:${bind}`).digest("base64url");

/** `place.v1.<country>.<region or ->.<expires>.<sig>`, or null without a SESSION_SECRET. */
export function signPlace(where: Place, env: Env = process.env, now = Date.now(), bind = ""): string | null {
  const secret = secretOf(env);
  if (!secret) return null;
  const p = place(where.country, where.region);
  const payload = `${p.country ?? "-"}.${p.region ?? "-"}.${Math.floor(now / 1000) + PLACE_TTL_SECONDS}`;
  return `place.v1.${payload}.${sig(secret, payload, bind)}`;
}

/** A signed, unexpired place, or null. */
export function verifyPlace(token: string | null | undefined, env: Env = process.env, now = Date.now(), bind = ""): Place | null {
  const secret = secretOf(env);
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "place" || parts[1] !== "v1") return null;
  const [, , country, region, expires, signature] = parts;
  const payload = `${country}.${region}.${expires}`;
  if (!safeEqual(signature, sig(secret, payload, bind))) return null;
  if (!/^\d+$/.test(expires) || Number(expires) < Math.floor(now / 1000)) return null;
  return place(country === "-" ? null : country, region === "-" ? null : region);
}

/** Vercel's own location headers, read only on Vercel. */
export function placeFromVercel(headers: Headers, env: Env = process.env): Place | null {
  if (!env.VERCEL) return null;
  const country = headers.get("x-vercel-ip-country");
  return country ? place(country, headers.get("x-vercel-ip-country-region")) : null;
}

const cookieIn = (header: string | null, name: string): string | undefined =>
  new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(header ?? "")?.[1];

let placeForTests: Place | null = null;
/** Tests: where every request reads as coming from (tests/helpers.ts sets an open place; null restores the real rules). */
export function setPlaceForTests(where: Place | null): void {
  placeForTests = where;
}

/** Where this request comes from: Vercel's headers, else the signed cookie, else unknown. */
export function requestPlace(headers: Headers, env: Env = process.env, now = Date.now()): Place {
  if (placeForTests) return placeForTests;
  return placeFromVercel(headers, env) ?? verifyPlace(cookieIn(headers.get("cookie"), PLACE_COOKIE), env, now) ?? { country: null, region: null };
}

/** The Set-Cookie for a signed place on the host that receives it (After Dark's own). */
export function placeCookie(where: Place, env: Env = process.env, now = Date.now()): string | null {
  const token = signPlace(where, env, now);
  if (!token) return null;
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${PLACE_COOKIE}=${token}; Path=/; Max-Age=${PLACE_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

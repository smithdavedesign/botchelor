/**
 * The optional account layer (M16). An account is a login attached to the anonymous user id (bz_uid) it
 * adopts, so signing up never moves data: your characters, dates and points are already keyed to that id.
 * Anonymous play is unchanged — nothing here is required to use the show.
 *
 * Two things live here:
 *  1. A SIGNED session. Today the id is an unsigned cookie (fine for an anonymous 122-bit UUID). Once an
 *     account owns things and can store an API key, the id must be unforgeable, so an authenticated session
 *     is an HMAC-signed token (lib/http reads it). Signing needs SESSION_SECRET; without it the app falls
 *     back to the old unsigned cookie and the password/Google flows are disabled (like the frontier gate).
 *  2. Account records: look up / create / link by handle+password or Google sub, with scrypt password
 *     hashing and constant-time checks.
 *
 * No secret or hash is ever logged or returned to the client.
 */
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "./db";
import { safeEqual } from "./http";

const scryptAsync = promisify(scrypt);

/* ----------------------------------- signed sessions ----------------------------------- */

export type SessionClaims = { uid: string; authenticated: boolean };

const b64url = (b: Buffer): string => b.toString("base64url");
const sessionSecret = (env: Record<string, string | undefined> = process.env): string | null => env.SESSION_SECRET || null;

/** True when the app can sign sessions (so accounts work). Without it, anonymous play continues unsigned. */
export const sessionsSignable = (env: Record<string, string | undefined> = process.env): boolean => Boolean(sessionSecret(env));

const hmac = (secret: string, data: string): Buffer => createHmac("sha256", secret).update(data).digest();

/**
 * A session token: `v1.<payload>.<sig>`, payload = base64url JSON {u,a,t}. Stateless (no DB session store):
 * the signature is the authority. t is the issue time (seconds), kept for future rotation/expiry.
 */
export function signSession(claims: SessionClaims, env: Record<string, string | undefined> = process.env): string | null {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const payload = b64url(Buffer.from(JSON.stringify({ u: claims.uid, a: claims.authenticated ? 1 : 0, t: Math.floor(Date.now() / 1000) })));
  return `v1.${payload}.${b64url(hmac(secret, payload))}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Verifies a session token and returns its claims, or null if missing, malformed or wrongly signed. */
export function verifySession(token: string | null | undefined, env: Record<string, string | undefined> = process.env): SessionClaims | null {
  const secret = sessionSecret(env);
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, payload, sig] = parts;
  const expected = b64url(hmac(secret, payload));
  if (!safeEqual(sig, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u?: unknown; a?: unknown };
    if (typeof claims.u !== "string" || !UUID.test(claims.u)) return null;
    return { uid: claims.u, authenticated: claims.a === 1 };
  } catch {
    return null;
  }
}

/* ----------------------------------- host moves ----------------------------------- */

/** How long a carry token is good for: it only has to survive one redirect. */
export const CARRY_TTL_SECONDS = 60;

/**
 * `nonce` is the receiving browser's: botchelor.com puts a random one in a cookie before sending the browser to the
 * old host, and only accepts a token carrying that same nonce. Without it anyone could mint a token for an identity of
 * their choosing and hand it to a stranger, who'd land on botchelor.com playing as (or signed in as) the attacker.
 */
export type CarryClaims = SessionClaims & { adult: boolean; nonce: string };

/** A carry nonce: 16 random bytes, base64url. */
export const newCarryNonce = (): string => b64url(randomBytes(16));
const NONCE = /^[A-Za-z0-9_-]{22}$/;
export const isCarryNonce = (value: string | null | undefined): value is string => typeof value === "string" && NONCE.test(value);

/**
 * A one-hop token that moves this browser's identity from the old host (botchelor.vercel.app) to the canonical
 * one, since cookies are per host (app/api/auth/carry). `carry.v2.<payload>.<sig>`: its own prefix and HMAC
 * context, so a carry token is never accepted as a session or a session as a carry; it expires in a minute.
 */
export function signCarry(claims: CarryClaims, env: Record<string, string | undefined> = process.env, now = Date.now()): string | null {
  const secret = sessionSecret(env);
  if (!secret || !isCarryNonce(claims.nonce)) return null;
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ u: claims.uid, a: claims.authenticated ? 1 : 0, g: claims.adult ? 1 : 0, n: claims.nonce, e: Math.floor(now / 1000) + CARRY_TTL_SECONDS }),
    ),
  );
  return `carry.v2.${payload}.${b64url(hmac(secret, `carry:${payload}`))}`;
}

/** Verifies a carry token: well formed, correctly signed, unexpired and bound to a nonce. */
export function verifyCarry(token: string | null | undefined, env: Record<string, string | undefined> = process.env, now = Date.now()): CarryClaims | null {
  const secret = sessionSecret(env);
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "carry" || parts[1] !== "v2") return null;
  const [, , payload, sig] = parts;
  if (!safeEqual(sig, b64url(hmac(secret, `carry:${payload}`)))) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u?: unknown; a?: unknown; g?: unknown; n?: unknown; e?: unknown };
    if (typeof c.u !== "string" || !UUID.test(c.u) || typeof c.e !== "number" || c.e < Math.floor(now / 1000)) return null;
    if (typeof c.n !== "string" || !isCarryNonce(c.n)) return null;
    return { uid: c.u, authenticated: c.a === 1, adult: c.g === 1, nonce: c.n };
  } catch {
    return null;
  }
}

/* ----------------------------------- passwords ----------------------------------- */

const SCRYPT_KEYLEN = 64;

/** `scrypt$<salt>$<hash>` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = (await scryptAsync(password, Buffer.from(saltB64, "base64url"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ----------------------------------- accounts ----------------------------------- */

export type Account = {
  user_id: string;
  handle: string | null;
  handle_display: string | null;
  email: string | null;
  google_sub: string | null;
  password_hash: string | null;
};

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** Normalises a handle for storage and lookup (case-insensitive); returns null if it isn't a legal handle. */
export const normaliseHandle = (handle: string): string | null => {
  const h = handle.trim().toLowerCase();
  return HANDLE_RE.test(h) ? h : null;
};

const ACCOUNT_COLUMNS = "user_id, handle, handle_display, email, google_sub, password_hash";

export async function accountForUser(db: Db, userId: string): Promise<Account | null> {
  const { rows } = await db.query<Account>(`select ${ACCOUNT_COLUMNS} from accounts where user_id = $1`, [userId]);
  return rows[0] ?? null;
}

export async function hasAccount(db: Db, userId: string): Promise<boolean> {
  // A real account has at least one credential. A shell row (user_id only, no handle/email/google_sub/password_hash)
  // is a non-account — the BYOK path writes one so user_keys's FK is satisfied for an anonymous MCP agent.
  const { rows } = await db.query(
    `select 1 from accounts where user_id = $1
       and (handle is not null or email is not null or google_sub is not null or password_hash is not null)`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * True when an anonymous identity (an unsigned legacy cookie, an unsigned-in session, an agent_id) names a user id
 * that has an account. An account's data is for its sign-in only, so a user id that got out (or was planted before
 * signing up) can't be used to export, delete or read the account.
 */
export async function needsSignIn(db: Db, auth: { userId: string; authenticated: boolean }): Promise<boolean> {
  return !auth.authenticated && (await hasAccount(db, auth.userId));
}

async function accountBy(db: Db, column: "handle" | "google_sub" | "email", value: string): Promise<Account | null> {
  const { rows } = await db.query<Account>(`select ${ACCOUNT_COLUMNS} from accounts where ${column} = $1`, [value]);
  return rows[0] ?? null;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Registers a handle+password account that ADOPTS the current anonymous id, so the user's existing
 * characters and dates stay theirs. Fails if that id already has an account, or the handle is taken.
 */
export async function registerAccount(db: Db, userId: string, handleDisplay: string, password: string): Promise<Account> {
  const handle = normaliseHandle(handleDisplay);
  if (!handle) throw new AuthError(422, "bad_handle", "Handle must be 3-20 characters: letters, numbers or underscores.");
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new AuthError(422, "bad_password", `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`);
  }
  if (await accountForUser(db, userId)) throw new AuthError(409, "already_account", "This session already has an account. Sign out first.");
  if (await accountBy(db, "handle", handle)) throw new AuthError(409, "handle_taken", "That handle is taken.");
  const password_hash = await hashPassword(password);
  try {
    await db.query(
      `insert into accounts (user_id, handle, handle_display, password_hash) values ($1, $2, $3, $4)`,
      [userId, handle, handleDisplay.trim(), password_hash],
    );
  } catch {
    // A race on the unique handle lands here.
    throw new AuthError(409, "handle_taken", "That handle is taken.");
  }
  return { user_id: userId, handle, handle_display: handleDisplay.trim(), email: null, google_sub: null, password_hash };
}

/** Logs in by handle+password. Returns the account's user id (the session id to issue), or throws. */
export async function loginWithPassword(db: Db, handleInput: string, password: string): Promise<string> {
  const handle = normaliseHandle(handleInput);
  const account = handle ? await accountBy(db, "handle", handle) : null;
  // Verify even when the handle is unknown, so a wrong handle and a wrong password take the same time.
  const ok = await verifyPassword(password, account?.password_hash ?? null);
  if (!account || !ok) throw new AuthError(401, "bad_credentials", "Wrong handle or password.");
  return account.user_id;
}

/**
 * Finds or creates the account for a Google identity, returning the session id to issue. If the Google sub
 * is known, logs into that account. Otherwise links Google to the current anonymous id (adopting it) when
 * that id has no account yet, or creates a fresh id when it does.
 */
export async function loginWithGoogle(db: Db, currentUserId: string, sub: string, email: string | null): Promise<string> {
  const existing = await accountBy(db, "google_sub", sub);
  if (existing) return existing.user_id;
  const currentHasAccount = Boolean(await accountForUser(db, currentUserId));
  const userId = currentHasAccount ? randomUUID() : currentUserId;
  // If this Google email already sits on another account, don't collide — link by sub only.
  const emailFree = email ? !(await accountBy(db, "email", email)) : false;
  await db.query(
    `insert into accounts (user_id, google_sub, email) values ($1, $2, $3)
     on conflict (user_id) do update set google_sub = excluded.google_sub,
       email = coalesce(accounts.email, excluded.email), updated_at = now()`,
    [userId, sub, emailFree ? email : null],
  );
  return userId;
}

/* ----------------------------------- Google OAuth ----------------------------------- */

export const googleConfigured = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);

/**
 * The exact OAuth redirect URI, which MUST be byte-identical in the authorization request (/start), the token
 * exchange (/callback) and what's registered in Google — a mismatch is the classic "redirect_uri_mismatch".
 * So it comes from one place: OAUTH_REDIRECT_BASE if set (pin it to the canonical domain), else Vercel's
 * production domain, else the request's own origin (local dev). Always the same value in both routes.
 */
export function oauthRedirectUri(req: Request, env: Record<string, string | undefined> = process.env): string {
  const base =
    env.OAUTH_REDIRECT_BASE?.replace(/\/+$/, "") ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : null) ||
    new URL(req.url).origin;
  return `${base}/api/auth/google/callback`;
}

/** A short-lived signed value tying the OAuth redirect to this browser (CSRF protection for the callback). */
export function signOAuthState(nonce: string, env: Record<string, string | undefined> = process.env): string | null {
  const secret = sessionSecret(env);
  return secret ? `${nonce}.${b64url(hmac(secret, nonce))}` : null;
}

export function verifyOAuthState(state: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  const secret = sessionSecret(env);
  if (!secret || !state) return null;
  const dot = state.lastIndexOf(".");
  if (dot < 1) return null;
  const nonce = state.slice(0, dot);
  return safeEqual(state.slice(dot + 1), b64url(hmac(secret, nonce))) ? nonce : null;
}

export type GoogleIdentity = { sub: string; email: string | null };

/**
 * Exchanges an OAuth code for the user's Google identity. fetchImpl is injectable for tests. The id_token's
 * payload is read without a signature check, which is safe here: it came straight from Google's token
 * endpoint over TLS in direct response to our client-secret-authenticated request (not from the browser).
 */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleIdentity> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new AuthError(502, "google_exchange_failed", "Google sign-in failed. Try again.");
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  const idToken = typeof body?.id_token === "string" ? body.id_token : null;
  const payload = idToken ? decodeJwtPayload(idToken) : null;
  const sub = typeof payload?.sub === "string" ? payload.sub : null;
  if (!sub) throw new AuthError(502, "google_exchange_failed", "Google sign-in failed. Try again.");
  const email = typeof payload?.email === "string" && payload.email_verified ? payload.email : null;
  return { sub, email };
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export { randomUUID };

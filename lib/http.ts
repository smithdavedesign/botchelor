import type { z } from "zod";
import { signSession, verifySession } from "./auth";

/**
 * Identity. Historically the user id is a random UUID in the `bz_uid` cookie (anonymous, unsigned). Once an
 * account can own things and hold an API key, that id must be unforgeable, so an authenticated session is a
 * SIGNED token in `bz_sess` (lib/auth). Both are read here: a valid signed cookie is authoritative (and may
 * be authenticated); a legacy `bz_uid` is still accepted as an anonymous identity, so anonymous play and the
 * old tests keep working. When SESSION_SECRET is unset the app simply never signs and behaves as before.
 */
export const USER_COOKIE = "bz_uid";
export const SESSION_COOKIE = "bz_sess";
export const MAX_BODY_BYTES = 10_000;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? status));
  }
}

export function readUserId(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

function cookies(req: Request): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1) out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return out;
}

export type Auth = { userId: string; authenticated: boolean };

/** The request's identity: the signed session if valid, else a legacy anonymous `bz_uid`, else null. */
export function authFromRequest(req: Request): Auth | null {
  const jar = cookies(req);
  const signed = verifySession(jar.get(SESSION_COOKIE));
  if (signed) return { userId: signed.uid, authenticated: signed.authenticated };
  const legacy = readUserId(jar.get(USER_COOKIE));
  return legacy ? { userId: legacy, authenticated: false } : null;
}

export function userIdFromRequest(req: Request): string | null {
  return authFromRequest(req)?.userId ?? null;
}

/** The identity from a Next.js server cookie store (server components): signed session first, else legacy. */
export function authFromCookieStore(store: { get(name: string): { value: string } | undefined }): Auth | null {
  const signed = verifySession(store.get(SESSION_COOKIE)?.value);
  if (signed) return { userId: signed.uid, authenticated: signed.authenticated };
  const legacy = readUserId(store.get(USER_COOKIE)?.value);
  return legacy ? { userId: legacy, authenticated: false } : null;
}

/** The user id from a Next.js server cookie store (server components): signed session first, else legacy. */
export function userIdFromCookieStore(store: { get(name: string): { value: string } | undefined }): string | null {
  return authFromCookieStore(store)?.userId ?? null;
}

export type Session = { userId: string; isNew: boolean; authenticated: boolean };

export function session(req: Request): Session {
  const existing = authFromRequest(req);
  return existing ? { ...existing, isNew: false } : { userId: crypto.randomUUID(), authenticated: false, isNew: true };
}

const secureFlag = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

/** The Set-Cookie for an identity: a signed `bz_sess` when the app can sign, else the legacy `bz_uid`. */
export function sessionCookies(claims: Auth): string[] {
  const token = signSession({ uid: claims.userId, authenticated: claims.authenticated });
  if (token) return [`${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_SECONDS}${secureFlag()}`];
  return [`${USER_COOKIE}=${claims.userId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_SECONDS}${secureFlag()}`];
}

/** Clears both identity cookies (sign out). */
export function clearSessionCookies(): string[] {
  const expire = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
  return [`${SESSION_COOKIE}=; ${expire}`, `${USER_COOKIE}=; ${expire}`];
}

export function json(body: unknown, status = 200, sess?: Session): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (sess?.isNew) for (const c of sessionCookies(sess)) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

/** A JSON response that (re)issues the session cookie, authenticated or not. For sign in / up / out. */
export function jsonWithSession(body: unknown, claims: Auth, status = 200, extraCookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  for (const c of [...sessionCookies(claims), ...extraCookies]) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

/** JSON only (blocks cross-site form posts together with the SameSite=Lax cookie), and small. */
export async function readJson(req: Request): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) {
    throw new ApiError(415, { error: "unsupported_media_type", message: "Send JSON with Content-Type: application/json." });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    throw new ApiError(413, { error: "body_too_large" });
  }
  const body = await req.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) throw new ApiError(413, { error: "body_too_large" });
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiError(400, { error: "invalid_json" });
  }
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown, error: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(422, {
      error,
      issues: result.error.issues.map((i) => ({ field: i.path.join(".") || "(body)", message: i.message })),
    });
  }
  return result.data;
}

/**
 * Constant-time string compare, so checking a secret (an admin token, a gate password) doesn't leak
 * its length or content through timing. The one shared helper; lib/model.ts and the gated routes use it.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Wraps a route handler: ApiErrors become their JSON response, anything else a generic 500. */
export function handle<C extends unknown[]>(fn: (req: Request, ...ctx: C) => Promise<Response>) {
  return async (req: Request, ...ctx: C): Promise<Response> => {
    try {
      return await fn(req, ...ctx);
    } catch (err) {
      if (err instanceof ApiError) return json(err.body, err.status);
      console.error("[api] unexpected error:", err instanceof Error ? err.message : "unknown");
      return json({ error: "internal_error" }, 500);
    }
  };
}

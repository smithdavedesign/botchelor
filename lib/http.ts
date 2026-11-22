import type { z } from "zod";
import { readSession, SESSION_RENEW_AFTER_SECONDS, sessionsSignable, signSession, verifySession, type SessionToken } from "./auth";
import { requestLabel, withDbLabel } from "./db-watch";

/**
 * Identity. A browser's identity is a SIGNED token in `bz_sess` (lib/auth): anonymous for a visitor, authenticated once
 * they sign in. The signature is what makes the id theirs: a user id is written in rows, logs and replies, so it is a
 * name, never a password.
 *
 * The bare `bz_uid` cookie (a user id with no signature, which anyone could type in) is how identity began. It is read
 * in three cases only (bareIdsAllowed, internalRequest), and never from a visitor's browser in production:
 *  - a request the server builds to call one of its own routes as someone (an MCP tool for its agent, a job booking
 *    for an owner): internalRequest below, which nothing outside this process can make;
 *  - an app that cannot sign at all (no SESSION_SECRET: local play), which behaves as it did before accounts;
 *  - LEGACY_BARE_UID=1, set by the test suite and the local harnesses so their personas stay one line.
 * 2026-11-21 audit: until then a bare cookie naming any user id was taken as that user, account or not.
 */
export const USER_COOKIE = "bz_uid";
export const SESSION_COOKIE = "bz_sess";
export const MAX_BODY_BYTES = 10_000;
/** The address MCP tools call an API route on, in-process (lib/mcp/dispatcher.ts callRoute). */
export const MCP_CALL_URL = "https://botchelor.vercel.app/api/_mcp";
/** Whether a route is being called by an MCP tool (an agent) rather than by someone's browser. */
export const isMcpCall = (req: Request): boolean => new URL(req.url).pathname === new URL(MCP_CALL_URL).pathname;
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

type Env = Record<string, string | undefined>;

/**
 * Whether a bare `bz_uid` from outside is taken as an identity: only where sessions can't be signed at all, or under
 * LEGACY_BARE_UID=1 (the tests and the local harnesses). Production signs and never sets the switch, so there an id
 * typed into a cookie is nobody.
 */
export const bareIdsAllowed = (env: Env = process.env): boolean => !sessionsSignable(env) || env.LEGACY_BARE_UID === "1";

/**
 * The requests this process built to call its own routes (internalRequest). Kept on globalThis so every copy of this
 * module a bundle makes reads the same set; a request from outside can never be in it.
 */
const INTERNAL_KEY = Symbol.for("botchelor.internalRequests");
const internalRequests: WeakSet<Request> = ((globalThis as Record<symbol, unknown>)[INTERNAL_KEY] ??= new WeakSet<Request>()) as WeakSet<Request>;

/**
 * A request the server makes to one of its own routes as `userId` (lib/mcp/dispatcher.ts callRoute for an agent; the
 * jobs that book a date for an owner). The route reads who it is from the bare cookie, which it takes only from a
 * request built here: an agent's id is its credential over MCP, checked there, and never a cookie anyone can send.
 */
export function internalRequest(userId: string | null | undefined, opts: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) headers.cookie = `${USER_COOKIE}=${userId}`;
  const query = opts.query && Object.keys(opts.query).length ? `?${new URLSearchParams(opts.query)}` : "";
  const req = new Request(`${MCP_CALL_URL}${query}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  internalRequests.add(req);
  return req;
}

/** Whether this request was built by internalRequest, in this process. */
export const isInternalRequest = (req: Request): boolean => internalRequests.has(req);

/**
 * A route handing its request on to another of our routes (a second date booked through the booking route): the new
 * request is the server's own call exactly when the one it came from was, so an agent's tool still acts as the agent.
 * A browser's request passes on as a browser's.
 */
export function passOn(from: Request, to: Request): Request {
  if (internalRequests.has(from)) internalRequests.add(to);
  return to;
}

/**
 * The request's identity: the signed session if valid; else a bare `bz_uid` on the server's own call, or where bare
 * ids are still allowed (bareIdsAllowed); else null.
 */
export function authFromRequest(req: Request): Auth | null {
  const jar = cookies(req);
  const signed = verifySession(jar.get(SESSION_COOKIE));
  if (signed) return { userId: signed.uid, authenticated: signed.authenticated };
  const bare = readUserId(jar.get(USER_COOKIE));
  return bare && (isInternalRequest(req) || bareIdsAllowed()) ? { userId: bare, authenticated: false } : null;
}

/**
 * Whether the request's identity is a signed session (bz_sess), not a bare `bz_uid` that anyone could type in. What a
 * person without an account keeps private (a companion conversation) is only theirs on a signed identity.
 */
export function signedIdentity(req: Request): boolean {
  return verifySession(cookies(req).get(SESSION_COOKIE)) !== null;
}

/** The request's signed session in full (lib/auth readSession: with its session version and when it was signed), or null. */
export function signedSession(req: Request): SessionToken | null {
  return readSession(cookies(req).get(SESSION_COOKIE));
}

/** signedIdentity, from a Next.js server cookie store. */
export function signedIdentityFromCookieStore(store: { get(name: string): { value: string } | undefined }): boolean {
  return verifySession(store.get(SESSION_COOKIE)?.value) !== null;
}

export function userIdFromRequest(req: Request): string | null {
  return authFromRequest(req)?.userId ?? null;
}

/**
 * The identity from a Next.js server cookie store (server components): the signed session, else a bare `bz_uid` only
 * where bare ids are still allowed (bareIdsAllowed). A page is always a browser's request, never the server's own.
 */
export function authFromCookieStore(store: { get(name: string): { value: string } | undefined }): Auth | null {
  const signed = verifySession(store.get(SESSION_COOKIE)?.value);
  if (signed) return { userId: signed.uid, authenticated: signed.authenticated };
  const bare = readUserId(store.get(USER_COOKIE)?.value);
  return bare && bareIdsAllowed() ? { userId: bare, authenticated: false } : null;
}

/** The user id from a Next.js server cookie store (server components): as authFromCookieStore. */
export function userIdFromCookieStore(store: { get(name: string): { value: string } | undefined }): string | null {
  return authFromCookieStore(store)?.userId ?? null;
}

export type Session = { userId: string; isNew: boolean; authenticated: boolean };

export function session(req: Request): Session {
  const existing = authFromRequest(req);
  return existing ? { ...existing, isNew: false } : { userId: crypto.randomUUID(), authenticated: false, isNew: true };
}

const secureFlag = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

/**
 * The Set-Cookie for an identity: a signed `bz_sess` when the app can sign, else the legacy `bz_uid`. `version`: the
 * session version to sign (a session signed again, or carried from another host, keeps its own); else the account's as
 * this process knows it (lib/session-versions.ts).
 */
export function sessionCookies(claims: Auth & { version?: number }): string[] {
  const token = signSession({ uid: claims.userId, authenticated: claims.authenticated, version: claims.version });
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

/**
 * A signed-in session runs out SESSION_MAX_AGE_SECONDS after it was signed (lib/auth.ts), so one in use is signed again:
 * once it's a day old, the next API reply carries it newly signed, for the same account and with its own session
 * version (one its account has ended stays ended). Never on a reply a shared cache could keep, nor over a session the
 * route sets itself (signing in or out).
 */
export function withRenewedSession(req: Request, res: Response, now = Date.now()): Response {
  const current = signedSession(req);
  if (!current?.authenticated || now / 1000 - current.issuedAt < SESSION_RENEW_AFTER_SECONDS) return res;
  if (!/\b(no-store|private)\b/.test(res.headers.get("cache-control") ?? "")) return res;
  if (res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))) return res;
  try {
    for (const c of sessionCookies({ userId: current.uid, authenticated: true, version: current.version })) res.headers.append("set-cookie", c);
  } catch {
    // A reply whose headers can't change (Response.redirect): a later call renews it.
  }
  return res;
}

/**
 * Wraps a route handler: ApiErrors become their JSON response, anything else a generic 500. Its queries carry its
 * method and route, so the pool's lines about long waits name it (lib/db-watch.ts, #1948), and so does its error line.
 * A signed-in session in use is signed again once a day (withRenewedSession).
 */
export function handle<C extends unknown[]>(fn: (req: Request, ...ctx: C) => Promise<Response>) {
  return async (req: Request, ...ctx: C): Promise<Response> => {
    const label = requestLabel(req);
    try {
      return withRenewedSession(req, await withDbLabel(label, () => fn(req, ...ctx)));
    } catch (err) {
      if (err instanceof ApiError) return json(err.body, err.status);
      const message = err instanceof Error ? err.message : "unknown";
      console.error(`[api] unexpected error in ${label}:`, message);
      // Counted for the monitor (lib/errors.ts), which alerts the owner; a lazy import keeps http.ts free of the db.
      await import("./errors").then((m) => m.recordServerError("api", new URL(req.url).pathname, message)).catch(() => {});
      return json({ error: "internal_error" }, 500);
    }
  };
}

/**
 * A JSON response for work that can run past the edge's 100-second idle cutoff (docs/hosting.md): a newline every
 * `everyMs` keeps the connection open, then the JSON (leading whitespace is valid JSON). The caller waits for the work
 * instead of getting a 504 at 100 s while the work goes on behind it (the daily job's parts, 2026-11-11).
 * `no-transform` keeps the server's compression from holding the newlines back. The status is 200 from the first
 * byte, so a failure is the body `{ error: "internal_error" }`, recorded for the monitor as handle() does.
 */
export function jsonWhenDone(req: Request, work: () => Promise<unknown>, everyMs = 20_000): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          /* the caller went away; the work still finishes */
        }
      };
      const tick = setInterval(() => send("\n"), everyMs);
      void (async () => {
        let out: unknown;
        try {
          out = await work();
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown";
          console.error("[api] unexpected error:", message);
          await import("./errors").then((m) => m.recordServerError("api", new URL(req.url).pathname, message)).catch(() => {});
          out = { error: "internal_error" };
        } finally {
          clearInterval(tick);
        }
        send(JSON.stringify(out));
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      })();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" },
  });
}

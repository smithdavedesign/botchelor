import type { z } from "zod";

/** Anonymous session: a random UUID in an HttpOnly cookie. It is never echoed in a response body. */
export const USER_COOKIE = "bz_uid";
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

export function userIdFromRequest(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === USER_COOKIE) return readUserId(part.slice(eq + 1).trim());
  }
  return null;
}

export type Session = { userId: string; isNew: boolean };

export function session(req: Request): Session {
  const existing = userIdFromRequest(req);
  return existing ? { userId: existing, isNew: false } : { userId: crypto.randomUUID(), isNew: true };
}

function sessionCookie(userId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${USER_COOKIE}=${userId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_SECONDS}${secure}`;
}

export function json(body: unknown, status = 200, sess?: Session): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (sess?.isNew) headers.append("set-cookie", sessionCookie(sess.userId));
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

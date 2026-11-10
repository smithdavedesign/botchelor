import { z } from "zod";
import { accountForUser, AuthError, loginWithPassword, sessionsSignable } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, json, jsonWithSession, parseBody, readJson } from "@/lib/http";
import { visitorKey } from "@/lib/limits";
import { LOGIN_WINDOW_MINUTES, loginHeld, recordLoginFailure } from "@/lib/login-guard";

const LoginInput = z.object({ handle: z.string().trim().min(1).max(40), password: z.string().min(1).max(400) });

/**
 * Sign in with a handle and password. The session id becomes that account's id (its characters and dates). Failed tries
 * are counted per handle and per visitor (lib/login-guard.ts): past the limit, password sign-in waits out the window.
 */
export const POST = handle(async (req) => {
  if (!sessionsSignable()) return json({ error: "accounts_unavailable", message: "Accounts are not enabled on this deployment yet." }, 503);
  const input = parseBody(LoginInput, await readJson(req), "invalid_login");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if (await loginHeld(db, input.handle, visitor)) {
    const held = json(
      {
        error: "too_many_attempts",
        message: `Too many wrong passwords. Try again in ${LOGIN_WINDOW_MINUTES} minutes, or sign in with Google if your account uses it.`,
      },
      429,
    );
    held.headers.set("retry-after", String(LOGIN_WINDOW_MINUTES * 60));
    return held;
  }
  try {
    const userId = await loginWithPassword(db, input.handle, input.password);
    const account = await accountForUser(db, userId);
    return jsonWithSession({ authenticated: true, handle: account?.handle_display ?? null }, { userId, authenticated: true });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === "bad_credentials") await recordLoginFailure(db, input.handle, visitor).catch(() => {});
      return json({ error: err.code, message: err.message }, err.status);
    }
    throw err;
  }
});

/**
 * What the Connections routes share (app/api/me/connections): who may use them (a signed-in account, on a deployment
 * that can seal keys), the limit on live checks, and the shape a pasted key has to have. Nothing here ever echoes a key:
 * a key that fails validation is refused by its field name only.
 */
import { z } from "zod";
import { byokAvailable } from "./keys";
import { authFromRequest, json } from "./http";
import { checkRateLimit } from "./rate-limit";

/** A signed-in account's user id, or the response that refuses everyone else (503 here without the secrets, 401 signed out). */
export function connectionsGate(req: Request): { userId: string; error?: never } | { error: Response; userId?: never } {
  if (!byokAvailable()) {
    return { error: json({ error: "byok_unavailable", message: "Bringing your own key isn't enabled on this deployment yet." }, 503) };
  }
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return { error: json({ error: "sign_in_required", message: "Sign in to connect your own keys." }, 401) };
  return { userId: auth.userId };
}

/** The live-check limit (rate-limit.ts key_check), or the 429 that says when to try again. */
export function checkLimit(userId: string): Response | null {
  const d = checkRateLimit(userId, "key_check");
  if (d.ok) return null;
  const minutes = Math.max(1, Math.ceil(d.retry_after_seconds / 60));
  return json(
    { error: "rate_limited", message: `That's a lot of key checks in a few minutes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, retry_after_seconds: d.retry_after_seconds },
    429,
  );
}

/**
 * A pasted key: trimmed, 8 to 400 characters, and one word of printable characters (a key never has a space or a line
 * break in it, so one with them is a bad paste). The messages name the rule, never the value.
 */
export const PastedKey = z
  .string()
  .trim()
  .min(8, "That's too short to be a key.")
  .max(400, "That's too long to be a key.")
  .regex(/^[\x21-\x7e]+$/, "A key is one word, with no spaces or line breaks.");

/** A model id as providers write them ("openai/gpt-4.1-mini", "deepseek/deepseek-chat-v3.1:free", "gemini-3.5-flash"). */
export const ModelId = z.string().trim().min(1).max(120).regex(/^[\w.:/@+-]+$/, "That isn't a model id.");

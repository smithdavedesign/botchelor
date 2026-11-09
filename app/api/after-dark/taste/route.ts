import { z } from "zod";
import { isAdmin } from "@/lib/admins";
import { canAfterDark } from "@/lib/adult/entitlement";
import { accessFor } from "@/lib/adult/place";
import { startTaste, TASTE_REFUSAL_TEXT } from "@/lib/adult/taste";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, isMcpCall, json, parseBody, readJson } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { requestPlace } from "@/lib/place";

export const dynamic = "force-dynamic";

const TASTE_LIMITS = { perHour: 5, perDay: 10 };

// The subscribe page's box: the 18+ self-declaration, the same one subscribing and the invite record.
const Input = z.object({ adult: z.literal(true, "Confirm you're 18 or older.") });

/**
 * Starts a free taste of After Dark (lib/adult/taste.ts): a signed-in person in a place where After Dark is fully open,
 * once. Refused for an anonymous cookie, an agent or crawler, a text-only or blocked place (451), someone who already
 * has or had After Dark, a second taste, and a day whose tastes are all taken.
 */
export const POST = handle(async (req: Request) => {
  if (isMcpCall(req) || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) {
    return json({ error: "people_only", message: "The free taste is for people, in a browser." }, 403);
  }
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "needs_sign_in", message: "Sign in to your account to start your free taste." }, 401);
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if ((visitor !== null && (await overLimit(db, "ad_taste", visitor, TASTE_LIMITS))) || (await overLimit(db, "ad_taste_user", auth.userId, TASTE_LIMITS))) {
    return json({ error: "rate_limited", message: "Too many tries. Try again in an hour." }, 429);
  }
  const access = accessFor(requestPlace(req.headers), await isAdmin(db, auth.userId));
  if (access.mode !== "open") {
    return json({ error: "not_available_here", message: access.reason ?? "The free taste isn't offered where you're connecting from." }, 451);
  }
  parseBody(Input, await readJson(req), "confirmations_required");
  if ((await canAfterDark(db, auth)).ok) return json({ error: "already_in", message: "You already have After Dark." }, 409);
  const started = await startTaste(db, auth.userId, access.place.country);
  if (!started.ok) return json({ error: started.why, message: TASTE_REFUSAL_TEXT[started.why] }, 409);
  return json({ ok: true, ends: started.ends.toISOString() });
});

import { z } from "zod";
import { isAdmin } from "@/lib/admins";
import { accountEmail, recordSelfDeclaration } from "@/lib/adult/billing";
import { canAfterDark } from "@/lib/adult/entitlement";
import { emailRequest, NOTE_MAX, requestInvite } from "@/lib/adult/invites";
import { accessFor } from "@/lib/adult/place";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, isMcpCall, json, parseBody, readJson } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { requestPlace } from "@/lib/place";

export const dynamic = "force-dynamic";

const INVITE_LIMITS = { perHour: 5, perDay: 10 };

// The subscribe page's two boxes for the beta: the 18+ self-declaration, and the terms (a free month, video on them).
const Input = z.object({
  adult: z.literal(true, "Confirm you're 18 or older."),
  terms: z.literal(true, "Confirm you've read how the beta works."),
  note: z.string().max(NOTE_MAX).optional(),
});

/**
 * Asks for an After Dark invite (lib/adult/invites.ts): a signed-in person, once. Refused for an anonymous cookie, an
 * agent or crawler, a place where After Dark isn't offered (451), someone who already has After Dark, and an account
 * with no email to write back to. Records the 18+ declaration with the country, then emails the operator the review
 * link. Asking again returns the request as it stands.
 */
export const POST = handle(async (req: Request) => {
  if (isMcpCall(req) || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) {
    return json({ error: "people_only", message: "Invites are for people, in a browser." }, 403);
  }
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "needs_sign_in", message: "Sign in to your account to ask for an invite." }, 401);
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if ((visitor !== null && (await overLimit(db, "ad_invite", visitor, INVITE_LIMITS))) || (await overLimit(db, "ad_invite_user", auth.userId, INVITE_LIMITS))) {
    return json({ error: "rate_limited", message: "Too many tries. Try again in an hour." }, 429);
  }
  const access = accessFor(requestPlace(req.headers), await isAdmin(db, auth.userId));
  if (access.mode === "blocked") return json({ error: "not_available_here", message: access.reason ?? "After Dark isn't offered where you're connecting from." }, 451);
  const input = parseBody(Input, await readJson(req), "confirmations_required");
  if ((await canAfterDark(db, auth)).ok) return json({ error: "already_in", message: "You already have After Dark." }, 409);
  const email = await accountEmail(db, auth.userId);
  if (!email) {
    return json({ error: "needs_email", message: "Add an email to your account first (Account → Email), so we can write back with your invite." }, 422);
  }
  await recordSelfDeclaration(db, auth.userId, access.place.country);
  const { invite, created } = await requestInvite(db, auth.userId, { email, note: input.note ?? null, country: access.place.country });
  if (created) await emailRequest(db, invite).catch((err) => console.error("[invite] request email failed:", err instanceof Error ? err.message : "unknown"));
  return json({ status: invite.status });
});

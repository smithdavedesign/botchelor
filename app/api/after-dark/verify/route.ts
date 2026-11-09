import { isAdmin } from "@/lib/admins";
import { ageCheckState, createAgeSession, diditConfig, VERIFY_LIMITS } from "@/lib/adult/age-check";
import { billingFlagged } from "@/lib/adult/billing";
import { canAfterDark } from "@/lib/adult/entitlement";
import { afterDarkBase } from "@/lib/after-dark-host";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, isMcpCall, json } from "@/lib/http";
import { afterDarkAccess, verifyOpens } from "@/lib/jurisdiction";
import { overLimit, visitorKey } from "@/lib/limits";
import { requestPlace } from "@/lib/place";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Starts an age check with Didit (lib/adult/age-check.ts) and answers the url of Didit's page to send the person to.
 * "Not available" (404) while Didit isn't set up. Refused for an agent or crawler, an anonymous cookie, too many tries,
 * a place where a pass opens nothing more (lib/jurisdiction.ts VERIFY_OPENS), someone already passed, an admin (open
 * everywhere already), and an account held by a chargeback or refund flag.
 */
export const POST = handle(async (req: Request) => {
  const config = diditConfig();
  if (!config) return json({ error: "not_available", message: "Age checks aren't available yet." }, 404);
  if (isMcpCall(req) || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) {
    return json({ error: "people_only", message: "Age checks are for people, in a browser." }, 403);
  }
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "needs_sign_in", message: "Sign in to your account to verify your age." }, 401);
  const db = await getDb();
  const where = requestPlace(req.headers);
  const access = afterDarkAccess(where);
  if (access.mode === "open" || !verifyOpens(where) || (await isAdmin(db, auth.userId))) {
    return json({ error: "not_needed_here", message: "There's no age check to do where you're connecting from." }, 409);
  }
  if ((await ageCheckState(db, auth.userId)) === "passed") return json({ error: "already_verified", message: "You've already verified your age." }, 409);
  if (!(await canAfterDark(db, auth)).ok && (await billingFlagged(db, auth.userId))) {
    return json({ error: "billing_review", message: "This account's last payment ended with a refund or a chargeback. Write to support and we'll look at it." }, 403);
  }
  const visitor = visitorKey(req.headers);
  if ((visitor !== null && (await overLimit(db, "ad_verify", visitor, VERIFY_LIMITS))) || (await overLimit(db, "ad_verify_user", auth.userId, VERIFY_LIMITS))) {
    return json({ error: "rate_limited", message: "Too many tries. Try again in an hour." }, 429);
  }
  const callback = `${afterDarkBase(requestBase(req))}/api/after-dark/verify/return`;
  try {
    const session = await createAgeSession(auth.userId, access.place.country, callback, config);
    return json({ url: session.url });
  } catch (err) {
    console.error("[age-check] could not start a Didit session:", err instanceof Error ? err.message : "unknown");
    return json({ error: "provider_unavailable", message: "The age check couldn't start. Try again in a few minutes." }, 502);
  }
});

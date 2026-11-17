import { accountClaimOn, CLAIM_LIMITS, claimCookie, claimIdentity, offerFromRequest } from "@/lib/account-claim";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { invalidateGraph } from "@/lib/graph-cache";
import { authFromRequest, handle, json, readJson } from "@/lib/http";
import { overLimit } from "@/lib/limits";

/** The answer, with the offer's cookie taken away: an offer is answered once. */
const answered = (body: unknown, status = 200): Response => {
  const res = json(body, status);
  res.headers.append("set-cookie", claimCookie(null));
  return res;
};

const NOTHING = "There's nothing waiting to be brought in: the offer lasts half an hour after you sign in, and works once.";

/**
 * Bring what this browser made before signing in into the account it signed in to (lib/account-claim.ts), or decline.
 *
 *   {"confirm": true}  → everything the registry marks as made by the old identity moves, in one transaction.
 *   {"decline": true}  → nothing moves; the offer is dropped.
 *
 * WHICH identity is never in the request: it comes from the signed, HttpOnly offer cookie this server set at sign-in,
 * and that offer is good only for the account it was made for. JSON only (lib/http readJson), which with the
 * SameSite=Lax cookies keeps another site's form from pressing the button.
 */
export const POST = handle(async (req) => {
  if (!accountClaimOn()) return json({ error: "not_found" }, 404);
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "sign_in_required", message: "Sign in to do that." }, 401);
  const body = (await readJson(req)) as Record<string, unknown> | null;
  const decline = Boolean(body && typeof body === "object" && body.decline === true);
  const confirm = Boolean(body && typeof body === "object" && body.confirm === true);
  if (decline) return answered({ declined: true });
  if (!confirm) return json({ error: "confirm_required", message: 'Send {"confirm": true} to bring them in, or {"decline": true} to leave them.' }, 422);

  const offer = offerFromRequest(req);
  // No offer, a forged or expired one, or one made for another account: nothing is looked up, nothing moves.
  if (!offer || offer.to !== auth.userId) return answered({ error: "no_offer", message: NOTHING }, 403);

  const db = await getDb();
  if (await overLimit(db, "account-claim", auth.userId, CLAIM_LIMITS)) {
    return json({ error: "rate_limited", message: "Too many tries. Wait a while and try again." }, 429);
  }
  const result = await claimIdentity(db, offer.from, offer.to);
  if (!result.ok) {
    // A failure that rolled back keeps the offer, so the button can be pressed again; a refusal ends it.
    if (result.refused === "failed") return json({ error: "claim_failed", message: "That didn't go through, and nothing was moved. Try again." }, 500);
    return answered({ error: "no_offer", message: NOTHING }, result.refused === "off" ? 404 : 403);
  }
  // Counts only: nothing here says who (the two ids are in account_aliases, and nowhere else).
  track("identity_claimed", { characters: result.moved.characters.length, dates: result.moved.dates, conversations: result.moved.conversations, pictures: result.moved.pictures });
  invalidateGraph(); // their characters' pages and lists show the new owner's view now
  return answered({ claimed: true, characters: result.moved.characters.length, dates: result.moved.dates, conversations: result.moved.conversations, pictures: result.moved.pictures });
});

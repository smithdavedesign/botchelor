import { deleteAccount } from "@/lib/account";
import { accountForUser, googleConfigured, needsSignIn, sessionsSignable } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { invalidateGraph } from "@/lib/graph-cache";
import { getPoints } from "@/lib/game";
import { episodeAllowance } from "@/lib/allowance";
import { authFromRequest, handle, json, readJson } from "@/lib/http";

/**
 * Who the current session is and its points. Points are read-only (derived from revealed predictions). The
 * account fields drive the /account page: whether sign-in is available, and this session's login if any.
 */
export const GET = handle(async (req) => {
  const auth = authFromRequest(req);
  const accountsAvailable = sessionsSignable();
  if (!auth) return json({ points: 0, authenticated: false, account: null, accounts_available: accountsAvailable, google_available: googleConfigured() });
  const db = await getDb();
  const account = auth.authenticated ? await accountForUser(db, auth.userId) : null;
  // The nav meter's numbers (#1005: it refreshes after a spend instead of waiting for the next page load).
  const allowance = await episodeAllowance(db, auth.userId);
  return json({
    points: await getPoints(db, auth.userId),
    dates_left: allowance.left,
    tokens_left: allowance.pack_left,
    authenticated: auth.authenticated,
    account: account
      ? { handle: account.handle_display, has_password: Boolean(account.password_hash), has_google: Boolean(account.google_sub) }
      : null,
    accounts_available: accountsAvailable,
    google_available: googleConfigured(),
  });
});

/**
 * Delete this account and all its data (PRD §6.1). Requires { "confirm": true } so it can't be triggered
 * by accident. Removes the profile, characters, private souls, predictions, orders and side-game data;
 * characters already in shared episodes keep their fictional sheet but lose the soul and the owner link. An
 * account needs its sign-in (lib/auth needsSignIn).
 */
export const DELETE = handle(async (req) => {
  const auth = authFromRequest(req);
  if (!auth) return json({ error: "no_account", message: "No account to delete." }, 404);
  const body = await readJson(req);
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).confirm !== true) {
    return json(
      { error: "confirm_required", message: 'Send {"confirm": true} to permanently delete your account and all its data.' },
      422,
    );
  }
  const db = await getDb();
  if (await needsSignIn(db, auth)) return json({ error: "sign_in_required", message: "This is an account: sign in to do that." }, 401);
  const result = await deleteAccount(db, auth.userId);
  invalidateGraph(); // their characters leave the Constellation now
  return json({ deleted: true, ...result });
});

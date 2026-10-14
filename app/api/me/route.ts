import { deleteAccount } from "@/lib/account";
import { getDb } from "@/lib/db";
import { getPoints } from "@/lib/game";
import { handle, json, readJson, userIdFromRequest } from "@/lib/http";

/** Read-only points total. Points have no write route: they are derived from revealed predictions. */
export const GET = handle(async (req) => {
  const userId = userIdFromRequest(req);
  if (!userId) return json({ points: 0 });
  return json({ points: await getPoints(await getDb(), userId) });
});

/**
 * Delete this account and all its data (PRD §6.1). Requires { "confirm": true } so it can't be triggered
 * by accident. Removes the profile, characters, private souls, predictions, orders and side-game data;
 * characters already in shared episodes keep their fictional sheet but lose the soul and the owner link.
 */
export const DELETE = handle(async (req) => {
  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "no_account", message: "No account to delete." }, 404);
  const body = await readJson(req);
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).confirm !== true) {
    return json(
      { error: "confirm_required", message: 'Send {"confirm": true} to permanently delete your account and all its data.' },
      422,
    );
  }
  const result = await deleteAccount(await getDb(), userId);
  return json({ deleted: true, ...result });
});

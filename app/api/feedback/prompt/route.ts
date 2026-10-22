import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, readJson } from "@/lib/http";
import { markBetaPromptSeen } from "@/lib/user-feedback";

export const dynamic = "force-dynamic";

/**
 * The page showed the one-time beta prompt. For a signed-in account it's remembered on the account, so another device
 * doesn't ask again; anyone else is remembered by their browser alone (localStorage), so this is a no-op for them.
 * JSON only, like every write (lib/http readJson), so another site can't post it.
 */
export const POST = handle(async (req) => {
  await readJson(req);
  const auth = authFromRequest(req);
  if (auth?.authenticated) await markBetaPromptSeen(await getDb(), auth.userId);
  return json({ ok: true });
});

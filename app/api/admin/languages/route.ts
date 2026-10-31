import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { languageWindows } from "@/lib/language-seen";

export const dynamic = "force-dynamic";

/**
 * Owner-only: which languages people and agents wrote in, last 7 and 30 days (lib/language-seen.ts), our own traffic
 * left out unless ?include_ours=1.
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const includeOurs = new URL(req.url).searchParams.get("include_ours") === "1";
  return json(await languageWindows(await getDb(), { includeOurs }));
});

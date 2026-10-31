import { adminAuthorized } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { checkBatch, recheckBatch } from "@/lib/showcase-check";

export const dynamic = "force-dynamic";
// A batch of checks (lib/showcase-check.ts): a clip's frames cut and each through Venice's vision model.
export const maxDuration = 300;

/**
 * The next few After Dark posts still rated explicit, through the PG check: a dressed one goes to the safe side
 * (lib/showcase-check.ts). Hourly from a DigitalOcean scheduled job (.do/app.yaml), and from /admin/showcase. 404
 * unless one of those.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req) && !(await adminAuthorized(req))) return json({ error: "not_found" }, 404);
  // ?recheck=1: the safe side looked at again, a batch at a time (lib/showcase-check.ts recheckBatch).
  const recheck = new URL(req.url).searchParams.get("recheck") === "1";
  return json(recheck ? await recheckBatch(await getDb()) : await checkBatch(await getDb()));
}

export const GET = handle(run);
export const POST = handle(run);

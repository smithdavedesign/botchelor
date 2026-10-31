import { adminAuthorized } from "@/lib/admin-auth";
import { backfillClips } from "@/lib/adult/faststart-backfill";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { objectStore } from "@/lib/object-store";

export const dynamic = "force-dynamic";
// Each clip is a download and an upload to the bucket; a batch stays well under this (lib/adult/faststart-backfill.ts).
export const maxDuration = 300;

/**
 * Faststart (and mark) the clips already in the bucket, a batch at a time, until `left` is 0 (lib/adult/faststart-backfill.ts).
 * On After Dark's own host, where the clips are (Bunny). 404 unless an admin or the internal job secret, like the
 * showcase check. A `?batch=` of up to 40; fewer if a batch runs long.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req) && !(await adminAuthorized(req))) return json({ error: "not_found" }, 404);
  const store = objectStore();
  if (!store) return json({ error: "no_store", message: "No object store is configured on this host." }, 503);
  const asked = Number(new URL(req.url).searchParams.get("batch"));
  const batch = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 40) : 20;
  return json(await backfillClips(await getDb(), store, batch));
}

export const GET = handle(run);
export const POST = handle(run);

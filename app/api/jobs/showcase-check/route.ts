import { adminAuthorized } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json, jsonWhenDone } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { checkBatch, recheckBatch } from "@/lib/showcase-check";
import { audioBatch } from "@/lib/showcase-audio";
import { posterBatch } from "@/lib/showcase-posters";

export const dynamic = "force-dynamic";
// A batch of checks (lib/showcase-check.ts): a clip's frames cut and each through Venice's vision model.
export const maxDuration = 300;

/**
 * The next few After Dark posts still rated explicit, through the PG check: a dressed one goes to the safe side
 * (lib/showcase-check.ts); then each clip still without a still gets its first frame (lib/showcase-posters.ts), and each
 * clip not yet read is read for a sound track (lib/showcase-audio.ts).
 * Hourly from a DigitalOcean scheduled job (.do/app.yaml), and from /admin/showcase. 404
 * unless one of those.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req) && !(await adminAuthorized(req))) return json({ error: "not_found" }, 404);
  const q = new URL(req.url).searchParams;
  const db = await getDb();
  // ?recheck=1: the safe side looked at again, a batch at a time (lib/showcase-check.ts recheckBatch).
  if (q.get("recheck") === "1") return json(await recheckBatch(db));
  // ?posters=1: only the clips still without a still (lib/showcase-posters.ts), for a backfill.
  if (q.get("posters") === "1") return json(await posterBatch(db));
  // ?audio=1: only the clips not yet read for sound (lib/showcase-audio.ts), for a backfill.
  if (q.get("audio") === "1") return json(await audioBatch(db));
  // Hourly: the checks, then a still for each clip published since (they share the job's ffmpeg), then its sound.
  const batch = async () => ({ ...(await checkBatch(db)), posters: await posterBatch(db), audio: await audioBatch(db) });
  // The scheduled job's call is streamed (lib/http.ts jsonWhenDone): a batch of new clips can outlast the edge's 100 s
  // cutoff, and the job reads the answer's ok: true. /admin/showcase's button keeps the plain answer its loop reads.
  return internalJobAuthorized(req) ? jsonWhenDone(req, batch) : json(await batch());
}

export const GET = handle(run);
export const POST = handle(run);

import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { ensureCastBaselines } from "@/lib/season-gen";

export const dynamic = "force-dynamic";
// A baseline is a picture and two checks (lib/adult/media.ts ensureBaseline), two at most a run.
export const maxDuration = 300;

/**
 * After Dark's part of the daily job, on After Dark's own host (#1009, the 2026-10-30 prod loop): the house cast's
 * baselines. Run from the show's daily job, they were stored in the show's bucket, where After Dark (whose media is on
 * Bunny) couldn't read them, and a picture drawn from one failed with a 404. Called on ad.botchelor.com by the scheduled
 * job in .do/app.yaml, after the show's daily job. 404 unless that.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const baselines = await ensureCastBaselines(await getDb()).catch(() => ({ made: 0, errors: ["error"] }));
  return json({ ok: true, cast_baselines_made: baselines.made, errors: baselines.errors });
}

export const GET = handle(run);
export const POST = handle(run);

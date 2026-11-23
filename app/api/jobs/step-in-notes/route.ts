import { writeDueNotes } from "@/lib/adult/step-in-notes-pass";
import { getDb } from "@/lib/db";
import { handle, json, jsonWhenDone } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";

export const dynamic = "force-dynamic";
// Up to NOTES_RUN_MAX notes, each a reply; the pass stops starting new ones well inside this (NOTES_RUN_MS).
export const maxDuration = 300;

/**
 * The characters who write first (lib/adult/step-in-notes-pass.ts writeDueNotes): one pass over the Step in scenes that
 * could be due, on After Dark's own host. The scheduler doesn't call this route yet: its spec (.do/app.yaml) reaches
 * the live app only by hand, so the same pass runs from the two routes it already calls every hour there
 * (showcase-check, and after-dark-daily at 16 UTC). This one is for calling by hand, and for the day the spec gets a
 * line of its own. 404 unless it's the scheduled job or the internal token.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  return jsonWhenDone(req, async () => writeDueNotes(await getDb()));
}

export const GET = handle(run);
export const POST = handle(run);

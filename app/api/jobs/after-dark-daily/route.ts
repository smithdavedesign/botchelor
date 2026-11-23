import { checkPortraits, checkSheets, SHEETS_PER_DAY } from "@/lib/adult/agent-cast";
import { tellShowNightsOver } from "@/lib/adult/overnight";
import { NOTES_RIDE_ALONG, writeDueNotes } from "@/lib/adult/step-in-notes-pass";
import { getDb } from "@/lib/db";
import { handle, json, jsonWhenDone } from "@/lib/http";
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
  // Streamed (lib/http.ts jsonWhenDone): two baselines and a day's portrait checks can outlast the edge's 100 s cutoff,
  // and the scheduled job reads the answer's ok: true to know the run finished.
  return jsonWhenDone(req, async () => {
    const db = await getDb();
    const baselines = await ensureCastBaselines(db).catch(() => ({ made: 0, errors: ["error"] }));
    // The agent cast's sheets, read first (lib/adult/agent-cast.ts checkSheets: one cheap call each, the day's new cast),
    // so the portraits below have someone to open: everyone who isn't a person's character joins After Dark by itself
    // once both checks pass (David, 2026-11-23), where it used to wait for an admin to press the sheet check.
    const sheets = await checkSheets(db, { limit: SHEETS_PER_DAY }).catch(() => ({ checked: 0, passed: 0, failed: 0 }));
    // The agent cast's portraits, 30 a day of Hive's 100 (lib/adult/agent-cast.ts): each that passes joins After Dark.
    const portraits = await checkPortraits(db).catch(() => ({ checked: 0, opened: 0, failed: 0, stopped: "error" }));
    // Nights that continued an overnight date and were simply left (lib/adult/overnight.ts): the show gets its one fact
    // for each, ids and a time. One that ended is told when it's filed; this is the sweep for the rest.
    const overnights_told = await tellShowNightsOver(db).catch(() => 0);
    // At 16 UTC the scheduler calls this route in place of the hourly showcase check, so the hour's pass of Step in's
    // first notes (lib/adult/step-in-notes-pass.ts) rides here too: without it that hour would be skipped every day.
    const step_in_notes = await writeDueNotes(db, new Date(), NOTES_RIDE_ALONG).catch(() => null);
    return { ok: true, cast_baselines_made: baselines.made, errors: baselines.errors, agent_cast_sheets: sheets, agent_cast: portraits, overnights_told, step_in_notes };
  });
}

export const GET = handle(run);
export const POST = handle(run);

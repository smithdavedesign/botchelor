import { companionWriter } from "@/lib/companion";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { fillWorldWords, WORLD_WORDS_SCAN } from "@/lib/world-words";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** One pass's ceiling on what it may spend, in USD, whatever is asked. */
const CAP_MAX_USD = 2;

const bounded = (v: string | null, min: number, max: number, fallback: number): number => {
  const n = v === null ? Number.NaN : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * The words of each character's own world (lib/world-words.ts), on demand: what the hourly lobby job does for new and
 * edited sheets, for as many as `max` (a sample first, to see what a sheet costs, then the rest of the cast), stopping
 * at `cap` USD spent this pass. POST only, behind the jobs' own check (404 otherwise). Says what it wrote, what it cost
 * and how many sheets are left.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const url = new URL(req.url);
  const max = Math.round(bounded(url.searchParams.get("max"), 1, WORLD_WORDS_SCAN, 10));
  const capUsd = bounded(url.searchParams.get("cap"), 0, CAP_MAX_USD, 0.25);
  const db = await getDb();
  const model = await companionWriter(db);
  const done = await fillWorldWords(db, model, { max, capUsd, budgetMs: 240_000, concurrency: 4 });
  return json({ ...done, model: model !== null });
}

export const POST = handle(run);

import { getDb, type Db } from "@/lib/db";
import { advanceReel } from "./reels";

/**
 * Videos being made, asked after by the host itself (instrumentation.ts, After Dark's own deployment). A reel's shots
 * come back only when something asks (advanceReel, which the page polls while it is open), and Replicate drops a
 * prediction nobody collected in half an hour; the 2026-10-31 audit left six finished shots waiting 20 minutes because
 * the page was on the theater. This asks once a minute for every reel still being made, whatever is open.
 */
export const COLLECT_EVERY_MS = 60_000;
/** A reel younger than this is the page's own to poll (its shots are still being queued). */
const YOUNGER_THAN_MS = 45_000;
/** How many a pass asks after: each is a status call per shot to the provider, and a Hive check for a finished one. */
const AT_MOST = 6;
/** Older than this, advanceReel has given the reel up already (REEL_GIVE_UP_MS); nothing to ask after. */
const OLDER_THAN = "4 hours";

/** One pass: every reel still being made (oldest first, at most a few), asked after once. Never throws. */
export async function collectMakingReels(db: Db, now = Date.now()): Promise<{ asked: string[] }> {
  const { rows } = await db.query<{ id: string; owner_id: string; created_at: string | Date }>(
    `select id, owner_id, created_at from adult_reels where status = 'making' and created_at > now() - interval '${OLDER_THAN}' order by created_at limit $1`,
    [AT_MOST],
  );
  const asked: string[] = [];
  for (const r of rows) {
    if (now - new Date(r.created_at).getTime() < YOUNGER_THAN_MS) continue;
    try {
      await advanceReel(db, r.owner_id, r.id);
      asked.push(r.id);
    } catch (err) {
      console.warn(`reel collector: ${r.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { asked };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** The pass on a timer, once per server process; a pass still running when the next is due is left to finish. */
export function startReelCollector(everyMs = COLLECT_EVERY_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    getDb()
      .then((db) => collectMakingReels(db))
      .catch((err) => console.warn(`reel collector: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        running = false;
      });
  }, everyMs);
  // Never what keeps the process alive.
  if (typeof timer === "object" && timer && "unref" in timer) (timer as { unref: () => void }).unref();
}

/** For tests: forget the timer. */
export function stopReelCollector(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

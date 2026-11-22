import { pingDb } from "./db";

/**
 * The public database check (GET /api/health?db=1) for an outside uptime monitor, which must never hold the cron secret.
 * It answers only whether this server reached its database, and asks the database at most once every TTL_MS per
 * instance, however often it's called: one `select 1` on the health check's own connection (lib/db.ts pingDb), given
 * TIMEOUT_MS. Calls that come in while a check is running share it.
 */
const TTL_MS = 30_000;
const TIMEOUT_MS = 5_000;

let last: { at: number; ok: boolean } | null = null;
let running: Promise<boolean> | null = null;

export async function databaseReachable(opts: { ping?: () => Promise<void>; now?: () => number } = {}): Promise<boolean> {
  const now = opts.now ?? Date.now;
  if (last && now() - last.at < TTL_MS) return last.ok;
  if (!running) {
    const ping = opts.ping ?? pingDb;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
    });
    running = Promise.race([ping(), timeout])
      .then(
        () => true,
        () => false,
      )
      .then((ok) => {
        clearTimeout(timer);
        last = { at: now(), ok };
        running = null;
        return ok;
      });
  }
  return running;
}

export function forgetDatabaseCheckForTests(): void {
  last = null;
  running = null;
}

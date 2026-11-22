import type { Instrumentation } from "next";
// Zod's settings before any route builds a schema (lib/zod-config.ts); the browser gets them from instrumentation-client.ts.
import "./lib/zod-config";

/**
 * Server errors outside the API wrapper (pages, server components, actions) are counted for the monitor too
 * (lib/errors.ts). Next's own control flow (notFound, redirect) arrives with a NEXT_ digest and isn't an error.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : "";
  if (digest.startsWith("NEXT_")) return;
  const { recordServerError } = await import("./lib/errors");
  await recordServerError(context.routeType, request.path, err instanceof Error ? err.message : String(err));
};

/**
 * Before either host serves a request (Next awaits register), it holds sharp to its memory limits (lib/sharp-limits.ts)
 * and brings the database schema up to date (lib/db.ts prepareDb), so a deploy's first visitors don't wait for it. Then,
 * on the same connection, it writes the start's row (lib/ops-log.ts: the commit and memory limit), so /admin can say
 * what's running and tell a deploy from a restart after the container's own log is gone.
 * After Dark's own host (lib/after-dark-host.ts) also asks after the videos being made while nobody has their page open
 * (lib/adult/reel-collector.ts): a reel's shots come back only when asked, and Replicate drops one nobody collected in
 * half an hour. The test runner starts nothing.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV === "test") return;
  const { limitSharp } = await import("./lib/sharp-limits");
  await limitSharp();
  const { prepareDb } = await import("./lib/db");
  const { recordBoot } = await import("./lib/ops-log");
  await prepareDb({ onReady: (db) => recordBoot(db) });
  const { afterDarkOnly } = await import("./lib/after-dark-host");
  if (!afterDarkOnly()) return;
  const { startReelCollector } = await import("./lib/adult/reel-collector");
  startReelCollector();
}

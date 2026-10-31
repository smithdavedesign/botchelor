import type { Instrumentation } from "next";

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
 * After Dark's own host (lib/after-dark-host.ts) asks after the videos being made while nobody has their page open
 * (lib/adult/reel-collector.ts): a reel's shots come back only when asked, and Replicate drops one nobody collected in
 * half an hour. The show's host and the test runner start nothing.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV === "test") return;
  const { afterDarkOnly } = await import("./lib/after-dark-host");
  if (!afterDarkOnly()) return;
  const { startReelCollector } = await import("./lib/adult/reel-collector");
  startReelCollector();
}

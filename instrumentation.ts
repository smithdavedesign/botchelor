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

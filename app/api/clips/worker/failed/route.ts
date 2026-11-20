import { z } from "zod";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { clipWorkerAuthorized, failClip } from "@/lib/clip-requests";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/),
  attempt: z.number().int().min(1),
  error: z.string().max(2000),
  retry: z.boolean().optional(),
});

/**
 * The Mac couldn't make a clip (lib/clip-requests.ts failClip): `{ id, attempt, error, retry? }`. With `retry` (a
 * passing trouble) it goes back in the queue while attempts remain; otherwise it fails for good, a bought date it used
 * is given back and its owner is told. Needs `Authorization: Bearer $CLIP_WORKER_SECRET` (else 404).
 */
export const POST = handle(async (req: Request) => {
  if (afterDarkOnly() || !clipWorkerAuthorized(req)) return json({ error: "not_found" }, 404);
  const body = parseBody(Body, await readJson(req), "invalid_failure");
  const done = await failClip(await getDb(), { id: body.id, attempt: body.attempt, error: body.error, retry: body.retry ?? false });
  if (!done.ok) return json({ error: done.error }, done.error === "not_found" ? 404 : 409);
  return json({ ok: true, status: done.status });
});

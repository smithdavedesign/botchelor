import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { listQualityRuns, QUALITY_RUN_KINDS, saveQualityRun, type QualityRunKind } from "@/lib/quality-runs";

export const dynamic = "force-dynamic";

/** Owner-only: the latest quality runs, newest first (?limit=, 1 to 100, default 10; ?kind=golden|after_dark_observer). */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const params = new URL(req.url).searchParams;
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 10));
  const kind = params.get("kind");
  if (kind !== null && !(QUALITY_RUN_KINDS as readonly string[]).includes(kind)) return json({ error: "unknown_kind", kinds: QUALITY_RUN_KINDS }, 400);
  return json({ runs: await listQualityRuns(await getDb(), { limit, kind: (kind as QualityRunKind | null) ?? undefined }) });
});

const Input = z.object({
  kind: z.enum(QUALITY_RUN_KINDS),
  label: z.string().trim().min(1).max(120),
  sha: z.string().trim().max(64).nullable().optional(),
  at: z.iso.datetime({ offset: true }).optional(),
  // A run's summary numbers (the whole request is capped at 10 KB by readJson): never transcripts.
  metrics: z.record(z.string().max(80), z.unknown()),
});

/**
 * Owner-only: one quality run's summary (scripts/eval/golden.mjs --post, scripts/eval/observer-nightly.mjs). Posting the
 * same kind and label again replaces it.
 */
export const POST = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const saved = await saveQualityRun(await getDb(), {
    kind: input.kind,
    label: input.label,
    sha: input.sha ?? null,
    at: input.at ?? new Date().toISOString(),
    metrics: input.metrics,
  });
  return json({ saved }, 201);
});

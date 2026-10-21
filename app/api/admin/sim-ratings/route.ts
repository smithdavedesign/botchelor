import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { listSimRatings, saveSimRating } from "@/lib/real-metrics";

export const dynamic = "force-dynamic";

/** Owner-only: the simulated-visitor runs' averages, newest first (?limit=, 1 to 100, default 10). */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 10));
  return json({ ratings: await listSimRatings(await getDb(), limit) });
});

const Rating = z.number().min(0).max(10).nullable();
const Input = z.object({
  run: z.string().trim().min(1).max(80),
  sha: z.string().trim().max(64).nullable().optional(),
  at: z.iso.datetime({ offset: true }).optional(),
  overall_avg: Rating,
  mcp_avg: Rating,
  visitors: z.number().int().min(0).max(100),
});

/** Owner-only: one loop run's averages (scripts/loop/post-ratings.mjs). Posting the same run again replaces it. */
export const POST = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const row = {
    run: input.run,
    sha: input.sha ?? null,
    at: input.at ?? new Date().toISOString(),
    overall_avg: input.overall_avg,
    mcp_avg: input.mcp_avg,
    visitors: input.visitors,
  };
  await saveSimRating(await getDb(), row);
  return json({ saved: row }, 201);
});

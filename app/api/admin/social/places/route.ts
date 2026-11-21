import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { fixJobWorkplaces } from "@/lib/social/circles";
import { socialTiesOn } from "@/lib/social/switch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Input = z.object({
  /** What to fix: the show's workplaces named for a job (lib/social/place-names.ts). */
  fix: z.literal("job_workplaces"),
  /** Say what it would do, and change nothing. */
  dry_run: z.boolean().optional(),
});

/**
 * Admin only (the admin password or a signed-in admin): fixes the show's own places. `job_workplaces`: its workplaces
 * named for a job ("Flat Pack Furniture Maze Manager") become the place it's done, or go when there's none
 * (lib/social/circles.ts fixJobWorkplaces). scripts/social/backfill-circles.mjs --fix-workplaces posts here and logs the
 * event.
 */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (!socialTiesOn()) return json({ error: "off", message: "The social network is off (SOCIAL_TIES=0)." }, 409);
  const fixes = await fixJobWorkplaces(await getDb(), { dryRun: input.dry_run });
  if (!input.dry_run && fixes.length) {
    console.info(`[social] ${fixes.length} workplaces named for a job fixed: ${fixes.map((f) => `${f.name} → ${f.to?.name ?? "none"}`).join("; ").slice(0, 600)}`);
  }
  return json({ dry_run: input.dry_run === true, fixes });
});

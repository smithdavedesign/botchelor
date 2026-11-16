import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json, jsonWhenDone, parseBody, readJson } from "@/lib/http";
import { checkEpisode, storyCheckCounts, storyCheckOn, storyCheckSweep, undoRepair } from "@/lib/story-check";

export const dynamic = "force-dynamic";
// A backfill runs checks for up to BACKFILL_BUDGET_MS (each a short call on the show's paid model).
export const maxDuration = 300;

/** A backfill starts no check after this long, so it answers well inside the route's 300 s. */
const BACKFILL_BUDGET_MS = 200_000;

const Input = z.union([
  z.object({ episode_id: z.string().regex(/^[\w-]{1,64}$/), undo: z.literal(true).optional() }).strict(),
  z.object({ backfill: z.number().int().min(1).max(300) }).strict(),
]);

const REFUSALS = {
  episode_not_found: "No such date.",
  not_public: "Only a public date between public characters, not hidden by reports, is checked.",
  not_aired: "That date hasn't aired yet: only an aired date is checked.",
} as const;

/**
 * Owner-only: the story check (lib/story-check.ts, docs/story-check.md).
 * - GET: the verdicts on dates aired in the last 7 and 30 days (counts only), with what the checks cost.
 * - POST {episode_id}: checks that date now (again, if it was checked: the newest verdict stands) and answers its row,
 *   reason included (admin-only). {episode_id, undo: true}: puts back the finale a repair replaced (the date is then
 *   contradicts again, off the featured places). {backfill: n}: one sweep pass of up to n dates now, featured first,
 *   answered when it's done (a newline every 20 s keeps the connection open).
 * POST is refused while STORY_CHECK is "0".
 */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await storyCheckCounts(await getDb()));
});

export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  if (!storyCheckOn()) return json({ error: "off", message: "STORY_CHECK is off." }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_story_check");
  const db = await getDb();
  if ("backfill" in input) {
    const limit = input.backfill;
    return jsonWhenDone(req, async () => ({ story_check: await storyCheckSweep(db, new Date(), { limit, budgetMs: BACKFILL_BUDGET_MS }) }));
  }
  if (input.undo) {
    const undone = await undoRepair(db, input.episode_id);
    return "error" in undone ? json({ error: undone.error, message: "That date has no repair to undo." }, 409) : json(undone);
  }
  const done = await checkEpisode(db, input.episode_id);
  if ("error" in done) return json({ error: done.error, message: REFUSALS[done.error] }, done.error === "episode_not_found" ? 404 : 409);
  return json({ story_check: done.row });
});

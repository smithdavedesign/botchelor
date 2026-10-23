import { getDb } from "@/lib/db";
import { pairTimeline } from "@/lib/graph";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ a: string; b: string }> };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * One pair's public dates for the Constellation's panel (lib/graph.ts pairTimeline): each aired public date's ending
 * and the stage after it, the latest 30, and how many there are. Asked for only when someone opens "Show what
 * happened" on the pair, so the page's payload carries no per-date endings. 404 for a pair touching a private or
 * deleted character, or with no public date: exactly what the canvas already shows as existence only, or nothing.
 */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  if (!ID.test(a) || !ID.test(b)) return json({ error: "not_found" }, 404);
  const story = await pairTimeline(await getDb(), a, b);
  if (!story) return json({ error: "not_found" }, 404);
  return json(story);
});

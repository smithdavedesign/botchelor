import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { PUBLIC_CACHE } from "@/lib/asset-gate";
import { getDb } from "@/lib/db";
import { faceKitBytes, faceKitFile } from "@/lib/face-kit";
import { handle, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One file of a character's face kit (lib/face-kit.ts): a still (WebP) or the loop (MP4). Only a part that's ready is
 * served, and a part never changes once it is, so it's cached for a year. PG-checked before it was kept; marked
 * AI-generated like every picture a model drew here (lib/ai-mark.ts).
 */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const file = await faceKitFile(db, id);
  if (!file) return json({ error: "not_found" }, 404);
  const bytes = await faceKitBytes(file);
  if (!bytes) return json({ error: "not_found" }, 404);
  return new Response(aiBody(bytes, file.mime), { status: 200, headers: { "content-type": file.mime, "cache-control": PUBLIC_CACHE, ...AI_HEADERS } });
});

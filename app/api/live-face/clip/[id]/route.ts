import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { PUBLIC_CACHE } from "@/lib/asset-gate";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { libraryClipFile } from "@/lib/live-face/ditto-clips";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * One clip of a character's Ditto library (lib/live-face/ditto-clips.ts): their idle or a reaction, an MP4 rendered
 * once from the kit's PG-checked portrait. Only a ready clip is served; a clip never changes once it is, so it's
 * cached for a year (a new portrait means new rows). Marked AI-generated like every picture a model drew here.
 */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const file = await libraryClipFile(await getDb(), id);
  if (!file) return json({ error: "not_found" }, 404);
  return new Response(aiBody(file.bytes, file.mime), { status: 200, headers: { "content-type": file.mime, "cache-control": PUBLIC_CACHE, ...AI_HEADERS } });
});

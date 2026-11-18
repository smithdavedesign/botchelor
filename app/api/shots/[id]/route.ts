import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { PUBLIC_CACHE } from "@/lib/asset-gate";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { shotFile } from "@/lib/show-shots";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One of the show kit's shots (lib/show-shots.ts): an expression or a moment, as WebP. The address ends in .webp so the
 * edge keeps it (Cloudflare caches by extension, app/Avatar.tsx sized). Only a ready shot is served, and a shot never
 * changes once it's ready, so it's cached for a year. PG-checked before it was kept; marked AI-generated.
 */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const file = await shotFile(await getDb(), decodeURIComponent(id).replace(/\.webp$/, ""));
  if (!file) return json({ error: "not_found" }, 404);
  return new Response(aiBody(file.bytes, file.mime), { status: 200, headers: { "content-type": file.mime, "cache-control": PUBLIC_CACHE, ...AI_HEADERS } });
});

import { getDb } from "@/lib/db";
import { compareAudio } from "@/lib/live-face/compare";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * A compare's voiced line as a WAV, for the hosted renderers to fetch (they take URLs, not bytes): the id is a UUID
 * given to nobody but them, and the file is a sentence of a character's voice, nothing private.
 */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const bytes = await compareAudio(await getDb(), id.replace(/\.wav$/i, ""));
  if (!bytes) return json({ error: "not_found" }, 404);
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "content-length": String(bytes.length) } });
});

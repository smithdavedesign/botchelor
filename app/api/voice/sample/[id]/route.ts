import { AI_HEADERS } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";
import { objectStore, readBytes } from "@/lib/object-store";
import { voicePickerOn } from "@/lib/voice";
import { voiceSample } from "@/lib/voice-samples";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One pickable voice saying the sample line (lib/voice-samples.ts), for the builder's ▶. Made once, the first time anyone
 * plays it, then kept; the same bytes for everyone, so any cache may keep it. Marked AI-generated, as every voice is.
 */
export async function GET(_req: Request, ctx: Ctx) {
  if (!voicePickerOn()) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  const db = await getDb();
  const file = await voiceSample(db, id).catch((err) => {
    console.error(`[voice] sample ${id.slice(0, 20)} failed: ${err instanceof Error ? err.message.slice(0, 200) : "error"}`);
    return null;
  });
  if (!file) return new Response("Not available", { status: 503 });
  const store = file.object_key ? objectStore() : null;
  if (store && file.object_key) {
    const link = await store.presign(file.object_key).catch(() => null);
    if (link) return new Response(null, { status: 302, headers: { location: link.url, "cache-control": `public, max-age=${link.maxAge}`, "x-robots-tag": "noindex" } });
  }
  const bytes = await readBytes(file);
  if (!bytes) return new Response("Not available", { status: 503 });
  return new Response(new Uint8Array(bytes), { headers: { "content-type": file.mime, "cache-control": "public, max-age=86400", "x-robots-tag": "noindex", ...AI_HEADERS } });
}

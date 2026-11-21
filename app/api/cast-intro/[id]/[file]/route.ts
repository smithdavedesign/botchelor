import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { PUBLIC_CACHE } from "@/lib/asset-gate";
import { introAudio, introFile, isIntroClipFile } from "@/lib/cast-intros";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string; file: string }> };

export const dynamic = "force-dynamic";

/**
 * A cast intro (lib/cast-intros.ts): `intro.mp4` (or a render's `intro-<v>.mp4`) is the clip (a ready one only; it never changes once it is, so cached
 * for a year; marked AI-generated like every picture a model drew here), `audio.wav` the voiced line fal fetched to
 * render it (a sentence of a character's voice, nothing private; the id is a UUID nobody is told).
 */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id, file } = await ctx.params;
  const db = await getDb();
  // `intro-<render time>.mp4` is the same clip under the URL of one render (lib/cast-intros.ts introUrl).
  if (isIntroClipFile(file)) {
    const clip = await introFile(db, id);
    if (!clip) return json({ error: "not_found" }, 404);
    return new Response(aiBody(clip.bytes, clip.mime), { status: 200, headers: { "content-type": clip.mime, "cache-control": PUBLIC_CACHE, ...AI_HEADERS } });
  }
  if (file === "audio.wav") {
    const bytes = await introAudio(db, id);
    if (!bytes) return json({ error: "not_found" }, 404);
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "content-length": String(bytes.length) } });
  }
  return json({ error: "not_found" }, 404);
});

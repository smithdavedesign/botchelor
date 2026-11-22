import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { PUBLIC_CACHE } from "@/lib/asset-gate";
import { introAudio, introFile, introKey, isIntroClipFile } from "@/lib/cast-intros";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { cdnLink } from "@/lib/object-store";

type Ctx = { params: Promise<{ id: string; file: string }> };

export const dynamic = "force-dynamic";

/**
 * A cast intro (lib/cast-intros.ts): `intro.mp4` (or a render's `intro-<v>.mp4`) is the clip (a ready one only; it never changes once it is, so cached
 * for a year; marked AI-generated like every picture a model drew here), `audio.wav` the voiced line fal fetched to
 * render it (a sentence of a character's voice, nothing private; the id is a UUID nobody is told).
 *
 * The clip answers byte ranges (2026-11-22 audit: a request for its first kilobyte got all 3.5 MB), which Safari needs
 * before it plays a video at all and which let a browser fetch only what it plays, as /api/home-clip's files do. A clip
 * on Bunny's CDN (intros/, lib/object-store.ts cdnLink) is a redirect to a signed link there, which answers them from
 * the edge: sent from here, Next 16.4 streams the body without its Content-Length, so Cloudflare keeps the clip whole
 * and answers any range with all of it. One still in the bucket or Postgres is sent from here, as before.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id, file } = await ctx.params;
  const db = await getDb();
  // `intro-<render time>.mp4` is the same clip under the URL of one render (lib/cast-intros.ts introUrl).
  if (isIntroClipFile(file)) {
    const kept = await introKey(db, id);
    if (!kept) return json({ error: "not_found" }, 404);
    const link = kept.key ? await cdnLink(kept.key) : null;
    if (link) {
      // Kept (by Cloudflare too) no longer than the link is handed out for, so a kept redirect never points at a dead one.
      return new Response(null, { status: 302, headers: { location: link.url, "cache-control": `public, max-age=${Math.min(3600, link.maxAge)}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
    }
    const clip = await introFile(db, id);
    if (!clip) return json({ error: "not_found" }, 404);
    const body = aiBody(clip.bytes, clip.mime);
    const size = body.length;
    const headers = { "content-type": clip.mime, "cache-control": PUBLIC_CACHE, "accept-ranges": "bytes", ...AI_HEADERS };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    if (range && (range[1] || range[2])) {
      // "a-b", "a-" (to the end) or "-n" (the last n bytes).
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      return new Response(body.subarray(start, end + 1), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
    }
    return new Response(body, { status: 200, headers: { ...headers, "content-length": String(size) } });
  }
  if (file === "audio.wav") {
    const bytes = await introAudio(db, id);
    if (!bytes) return json({ error: "not_found" }, 404);
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "content-length": String(bytes.length) } });
  }
  return json({ error: "not_found" }, 404);
});

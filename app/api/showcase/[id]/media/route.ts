import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { afterDarkElsewhere } from "@/lib/after-dark-host";
import { PUBLIC_CACHE, PRIVATE_CACHE } from "@/lib/asset-gate";
import { signMediaGrant, verifyMediaGrant } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { objectStore, readBytes } from "@/lib/object-store";
import { postMedia, showcaseViewer } from "@/lib/showcase";
import { thumbFor, thumbSizeOf } from "@/lib/showcase-thumbs";

/**
 * A showcase post's picture or clip (lib/showcase.ts): only a live post (or its creator's, or an admin's look), only of a
 * rating this viewer may see. A pg one is cached publicly; anything else privately, never by a CDN. One in the bucket is
 * a redirect to a short-lived presigned link. `?size=tile|screen`: a smaller copy of a picture (lib/showcase-thumbs.ts),
 * for the grid and the reels; the same viewer's rules decide first. For a clip, a sized copy is its poster: the
 * picture it was filmed from (adult_images.source_image), or nothing, never the clip itself.
 *
 * With After Dark on its own host (lib/after-dark-host.ts), a file made there is in its store (Bunny), which the show's
 * can't read: the show sends the browser there (David, 2026-11-01: a character's clip didn't show; every After Dark clip
 * on the show was a blank tile). A file anyone may see goes as it is; any other carries `?g=`, the show's OK for that
 * post (lib/auth.ts signMediaGrant), since that host may not know who's watching.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const { id } = await params;
  const url = new URL(req.url);
  const m = await postMedia(db, await showcaseViewer(db, req), id, { granted: verifyMediaGrant(url.searchParams.get("g"), id) });
  if (!m) return new Response("Not found", { status: 404 });
  const elsewhere = m.source === "after_dark" ? afterDarkElsewhere() : null;
  if (elsewhere) {
    const q = new URLSearchParams();
    const asked = url.searchParams.get("size");
    if (asked) q.set("size", asked);
    const grant = m.rating === "pg" ? null : signMediaGrant(id);
    if (grant) q.set("g", grant);
    const location = `${elsewhere}/api/showcase/${encodeURIComponent(id)}/media${q.size ? `?${q}` : ""}`;
    // Kept for less than the grant lasts, so a cached redirect never carries a spent one.
    return new Response(null, { status: 302, headers: { location, "cache-control": grant ? "private, max-age=600" : "public, max-age=3600", "x-robots-tag": "noindex" } });
  }
  const row = (
    await db.query<{ mime: string; data: Buffer | Uint8Array | null; object_key: string | null; source_image: string | null }>(
      m.source === "pg"
        ? `select mime, data, object_key, null as source_image from studio_pg_pictures where id = $1`
        : `select mime, data, object_key, source_image from adult_images where id = $1 and status = 'ready'`,
      [m.media_id],
    )
  ).rows[0];
  if (!row) return new Response("Not found", { status: 404 });
  const cache = m.rating === "pg" ? PUBLIC_CACHE : PRIVATE_CACHE;
  const size = thumbSizeOf(url.searchParams.get("size"));
  const video = row.mime.startsWith("video/");
  if (size && (video || row.mime.startsWith("image/"))) {
    const thumb = await thumbFor(db, id, size, async () => {
      // A clip's start: the picture it was filmed from (a boomerang's source is a clip, which thumbFor turns down).
      const from = video
        ? row.source_image
          ? (await db.query<{ mime: string; data: Buffer | Uint8Array | null; object_key: string | null }>(`select mime, data, object_key from adult_images where id = $1`, [row.source_image])).rows[0]
          : null
        : row;
      const data = from ? await readBytes(from) : null;
      return from && data ? { data, mime: from.mime } : null;
    });
    if (thumb) return new Response(new Uint8Array(thumb), { headers: { "content-type": "image/webp", "cache-control": cache, "x-robots-tag": "noindex", ...AI_HEADERS } });
    if (video) return new Response("No poster", { status: 404, headers: { "cache-control": cache } });
  }
  const store = row.object_key ? objectStore() : null;
  if (store && row.object_key) {
    const link = await store.presign(row.object_key);
    return new Response(null, { status: 302, headers: { location: link.url, "cache-control": m.rating === "pg" ? `public, max-age=${link.maxAge}` : `private, max-age=${link.maxAge}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
  }
  const bytes = await readBytes(row);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(aiBody(bytes, row.mime), { headers: { "content-type": row.mime, "cache-control": cache, "x-robots-tag": "noindex", ...AI_HEADERS } });
}

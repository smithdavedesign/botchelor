import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { PUBLIC_CACHE, PRIVATE_CACHE } from "@/lib/asset-gate";
import { getDb } from "@/lib/db";
import { objectStore, readBytes } from "@/lib/object-store";
import { postMedia, showcaseViewer } from "@/lib/showcase";

/**
 * A showcase post's picture or clip (lib/showcase.ts): only a live post (or its creator's, or an admin's look), only of a
 * rating this viewer may see. A pg one is cached publicly; anything else privately, never by a CDN. One in the bucket is
 * a redirect to a short-lived presigned link.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const { id } = await params;
  const m = await postMedia(db, await showcaseViewer(db, req), id);
  if (!m) return new Response("Not found", { status: 404 });
  const row = (
    await db.query<{ mime: string; data: Buffer | Uint8Array | null; object_key: string | null }>(
      m.source === "pg" ? `select mime, data, object_key from studio_pg_pictures where id = $1` : `select mime, data, object_key from adult_images where id = $1 and status = 'ready'`,
      [m.media_id],
    )
  ).rows[0];
  if (!row) return new Response("Not found", { status: 404 });
  const cache = m.rating === "pg" ? PUBLIC_CACHE : PRIVATE_CACHE;
  const store = row.object_key ? objectStore() : null;
  if (store && row.object_key) {
    const link = await store.presign(row.object_key);
    return new Response(null, { status: 302, headers: { location: link.url, "cache-control": m.rating === "pg" ? `public, max-age=${link.maxAge}` : `private, max-age=${link.maxAge}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
  }
  const bytes = await readBytes(row);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(aiBody(bytes, row.mime), { headers: { "content-type": row.mime, "cache-control": cache, "x-robots-tag": "noindex", ...AI_HEADERS } });
}

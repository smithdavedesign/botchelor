import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";
import { authFromRequest } from "@/lib/http";
import { objectStore } from "@/lib/object-store";
import { pgPictureRef } from "@/lib/studio/pg";

/**
 * A PG Studio picture (lib/studio/pg.ts): to its owner (or an admin) only, never cached anywhere shared. One in the bucket
 * is a redirect to a short-lived presigned link (the same one all through its window, so the browser keeps its copy);
 * one still only in Postgres is sent from here.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = authFromRequest(req);
  const ref = await pgPictureRef(await getDb(), auth?.authenticated ? auth.userId : null, id);
  if (!ref) return new Response("Not found", { status: 404 });
  const store = ref.object_key ? objectStore() : null;
  if (store && ref.object_key) {
    const link = await store.presign(ref.object_key);
    return new Response(null, { status: 302, headers: { location: link.url, "cache-control": `private, max-age=${link.maxAge}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
  }
  if (!ref.data) return new Response("Not found", { status: 404 });
  return new Response(aiBody(ref.data, ref.mime), { headers: { "content-type": ref.mime, "cache-control": "private, max-age=31536000, immutable", "x-robots-tag": "noindex", ...AI_HEADERS } });
}

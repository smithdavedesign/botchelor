import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { mediaLink } from "@/lib/adult/media";
import { talkBytes, talkFile } from "@/lib/adult/talks";
import { AI_HEADERS } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";

const KEEP = "private, max-age=31536000, immutable";

/**
 * A talking moment (lib/adult/talks.ts) to its owner only, never cached anywhere shared: a presigned link from the
 * private bucket when it's there, else its bytes. Its path has /after-dark/ in it, so the privacy blur covers it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return new Response("Not found", { status: 404 });
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const { id } = await params;
  const file = await talkFile(db, viewer, id);
  if (!file) return new Response("Not found", { status: 404 });
  const link = file.object_key ? await mediaLink(file.object_key) : null;
  if (link) {
    return new Response(null, { status: 302, headers: { location: link.url, "cache-control": `private, max-age=${link.maxAge}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
  }
  const bytes = await talkBytes(file);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "content-type": file.mime, "cache-control": KEEP, "x-robots-tag": "noindex", ...AI_HEADERS } });
}

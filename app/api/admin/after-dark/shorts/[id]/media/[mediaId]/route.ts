import { mediaBytes, mediaLink, mediaRef } from "@/lib/adult/media";
import { adultViewer } from "@/lib/adult/mode";
import { shortMediaAllowed } from "@/lib/adult/shorts";
import { getDb } from "@/lib/db";
import { AI_HEADERS, aiBody } from "@/lib/ai-mark";

/**
 * A Short's cover, or a shot of its video (the video, its keyframe, its voice), to an entitled viewer
 * (lib/adult/shorts.ts shortMediaAllowed: the cover always; the shots once they've pressed play). Never to anyone else,
 * and never another file by this route. A ready file's bytes never change, so the viewer's own browser keeps it (never
 * a shared cache); a file in the private bucket is a short-lived presigned link instead, as on the owner's media route.
 */
const KEEP = "private, max-age=31536000, immutable";
const missing = () => new Response("Not found", { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return missing();
  const { id, mediaId } = await params;
  if (!(await shortMediaAllowed(db, viewer, id, mediaId))) return missing();
  const ref = await mediaRef(db, mediaId, null);
  if (!ref) return missing();
  const link = ref.key ? await mediaLink(ref.key) : null;
  if (link) {
    return new Response(null, {
      status: 302,
      headers: { location: link.url, "cache-control": `private, max-age=${link.maxAge}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" },
    });
  }
  const file = await mediaBytes(db, mediaId, null);
  if (!file) return missing();
  return new Response(aiBody(file.data, file.mime), { headers: { "content-type": file.mime, "cache-control": KEEP, "x-robots-tag": "noindex", ...AI_HEADERS } });
}

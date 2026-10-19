import { adultViewer } from "@/lib/adult/mode";
import { mediaBytes, mediaLinkValid } from "@/lib/adult/media";
import { getDb } from "@/lib/db";

/** A picture or clip from after dark: to a signed-in admin only, never cached anywhere shared. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  const { id } = await params;
  // Or a picture's short-lived signed link (lib/adult/media.ts signedMediaUrl): a video provider fetching a start frame.
  const q = new URL(req.url).searchParams;
  const linked = !admin && mediaLinkValid(id, q.get("until"), q.get("sig"));
  const file = admin || linked ? await mediaBytes(db, id) : null;
  if (linked && file?.mime.startsWith("video/")) return new Response("Not found", { status: 404 });
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: { "content-type": file.mime, "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}

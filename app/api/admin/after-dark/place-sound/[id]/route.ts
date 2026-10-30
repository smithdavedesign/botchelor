import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { mediaLink } from "@/lib/adult/media";
import { placeSoundBytes, placeSoundFile } from "@/lib/adult/place-sounds";
import { AI_HEADERS } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";

const KEEP = "private, max-age=31536000, immutable";

/** A place's sound (lib/adult/place-sounds.ts) to After Dark's viewers: a presigned link when it's in the bucket, else its bytes. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return new Response("Not found", { status: 404 });
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const { id } = await params;
  const file = await placeSoundFile(db, id);
  if (!file) return new Response("Not found", { status: 404 });
  const link = file.object_key ? await mediaLink(file.object_key) : null;
  if (link) {
    return new Response(null, { status: 302, headers: { location: link.url, "cache-control": `private, max-age=${link.maxAge}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
  }
  const bytes = await placeSoundBytes(file);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "content-type": file.mime, "cache-control": KEEP, "x-robots-tag": "noindex", ...AI_HEADERS } });
}

import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { getMediaThumb, keepMediaThumb, mediaBytes, mediaLink, mediaLinkValid, mediaRef } from "@/lib/adult/media";
import { resizedWebp, thumbWidth } from "@/lib/thumbs";
import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";

/**
 * A picture or clip from after dark: to a signed-in admin only, never cached anywhere shared. A ready file's bytes never
 * change, so the admin's own browser keeps it: without that, every view (and the reel player preloading every shot)
 * downloaded it from Postgres again, which used up the database's network transfer and took the site down (2026-10-20).
 *
 * A file in the private bucket (lib/object-store.ts) isn't read here at all: the admin is redirected to a short-lived
 * presigned link, the same one all through its window, so the browser's copy is reused. Checked first, as before.
 */
const KEEP = "private, max-age=31536000, immutable";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice. A provider's signed link is unaffected.
  if (admin) {
    const refused = await mediaRefusal(db, admin);
    if (refused) return refused;
  }
  const { id } = await params;
  // Or a picture's short-lived signed link (lib/adult/media.ts signedMediaUrl): a video provider fetching a start frame.
  const q = new URL(req.url).searchParams;
  const linked = !admin && mediaLinkValid(id, q.get("until"), q.get("sig"));
  // The admin sees their own (or, as moderator, anyone's); a signed link names the one picture itself (null viewer).
  const viewer = admin ?? null;
  const ref = admin || linked ? await mediaRef(db, id, viewer) : null;
  if (!ref || (linked && ref.mime.startsWith("video/"))) return new Response("Not found", { status: 404 });
  // A grid's size (?w=, lib/thumbs.ts): a WebP copy resized once and kept, so a Studio grid stops showing 3 MB PNGs by
  // the dozen (the audit, 2026-10-31, F46). The full picture stays the default (the lightbox, a provider's start frame).
  const width = admin && ref.mime.startsWith("image/") ? thumbWidth(q.get("w")) : null;
  if (width) {
    const kept = await getMediaThumb(db, id, width);
    const small = kept ?? (await (async () => {
      const full = await mediaBytes(db, id, viewer);
      const made = full ? await resizedWebp(full.data, width) : null;
      if (made) await keepMediaThumb(db, id, width, made);
      return made;
    })());
    if (small) return new Response(new Uint8Array(small), { headers: { "content-type": "image/webp", "cache-control": KEEP, "x-robots-tag": "noindex", ...AI_HEADERS } });
  }
  const link = admin && ref.key ? await mediaLink(ref.key) : null;
  if (link) {
    // Kept by the admin's browser only until the link's window ends (it then gets the next window's link).
    return new Response(null, {
      status: 302,
      headers: { location: link.url, "cache-control": `private, max-age=${link.maxAge}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" },
    });
  }
  // A provider gets the bytes from here (a start frame is a picture, never a clip, and a provider may not follow a
  // redirect), as does any file still only in Postgres.
  const file = await mediaBytes(db, id, viewer);
  if (!file) return new Response("Not found", { status: 404 });
  // Made by a model: a picture marked AI-generated in its XMP (one stored before the mark gets it here); every file in
  // its headers (lib/ai-mark.ts).
  return new Response(aiBody(file.data, file.mime), {
    headers: { "content-type": file.mime, "cache-control": admin ? KEEP : "private, no-store", "x-robots-tag": "noindex", ...AI_HEADERS },
  });
}

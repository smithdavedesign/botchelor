import { AI_HEADERS } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";
import { homeClipFile } from "@/lib/home-clip";
import { objectStore } from "@/lib/object-store";

type Ctx = { params: Promise<{ id: string; file: string }> };

/** A clip's bytes never change (a new upload is a new id), so anyone may keep them; a day, since its date can still be taken down. */
const CACHE = "public, max-age=86400";

/**
 * The home clip's two files (lib/home-clip.ts): /api/home-clip/<id>/loop.mp4 and /poster.jpg. Public, like the date they
 * show, and only while that date is: the read checks it again (aired, public, not hidden, both characters public), so
 * a date taken down takes its clip with it. In the store, a redirect to a signed link (the store answers byte ranges);
 * from the database, sent from here with byte ranges, which Safari needs before it plays a video at all.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id, file } = await ctx.params;
  const which = file === "loop.mp4" ? "loop" : file === "poster.jpg" ? "poster" : null;
  if (!which || !/^[\w-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const found = await homeClipFile(await getDb(), id, which);
  if (!found) return new Response("Not found", { status: 404 });
  const store = found.key ? objectStore() : null;
  if (store && found.key) {
    const link = await store.presign(found.key);
    // Kept no longer than the link is handed out for (lib/object-store.ts LINK_WINDOW_MS), so a kept redirect never points at a dead one.
    return new Response(null, { status: 302, headers: { location: link.url, "cache-control": `public, max-age=${Math.min(3600, link.maxAge)}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
  }
  const bytes = found.bytes;
  if (!bytes) return new Response("Not found", { status: 404 });
  const base = { "content-type": found.mime, "cache-control": CACHE, "accept-ranges": "bytes", "x-robots-tag": "noindex", ...AI_HEADERS };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    // "a-b", "a-" (to the end) or "-n" (the last n bytes).
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...base, "content-length": String(bytes.length) } });
}

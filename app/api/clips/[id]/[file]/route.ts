import { AI_HEADERS } from "@/lib/ai-mark";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { clipFile } from "@/lib/clip-requests";
import { getDb } from "@/lib/db";
import { userIdFromRequest } from "@/lib/http";
import { objectStore, readBytes } from "@/lib/object-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; file: string }> };

/**
 * A requested clip's files (lib/clip-requests.ts): /api/clips/<id>/clip.mp4 and its cover (/poster.png or /poster.jpg).
 * Its owner can always open them; anyone else only while the date may be seen by link (aired, public or unlisted, not
 * hidden, both characters public), so a date taken down takes its clip with it. Never kept by a shared cache: who may
 * see it can change. `?download=1` sends the MP4 from here as an attachment (a same-origin file the page can save or
 * hand to the phone's share sheet); otherwise a stored file is a redirect to a signed link, and one kept in Postgres is
 * sent from here with byte ranges, which Safari needs before it plays a video.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id, file } = await ctx.params;
  const which = file === "clip.mp4" ? "clip" : file === "poster.png" || file === "poster.jpg" ? "poster" : null;
  if (afterDarkOnly() || !which || !/^[\w-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const found = await clipFile(await getDb(), id, which, userIdFromRequest(req));
  if (!found) return new Response("Not found", { status: 404 });
  const cache = "private, max-age=3600";
  const download = which === "clip" && new URL(req.url).searchParams.get("download") === "1";
  const store = found.key ? objectStore() : null;
  if (store && found.key && !download) {
    const link = await store.presign(found.key);
    return new Response(null, { status: 302, headers: { location: link.url, "cache-control": `private, max-age=${Math.min(3600, link.maxAge)}`, "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
  }
  const bytes = found.bytes ?? (found.key ? await readBytes({ object_key: found.key }) : null);
  if (!bytes) return new Response("Not found", { status: 404 });
  const base: Record<string, string> = { "content-type": found.mime, "cache-control": cache, "accept-ranges": "bytes", "x-robots-tag": "noindex", ...AI_HEADERS };
  if (download) base["content-disposition"] = `attachment; filename="botchelor-clip-${id.slice(0, 8)}.mp4"`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...base, "content-length": String(bytes.length) } });
}

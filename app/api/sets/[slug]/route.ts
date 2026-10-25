import { AI_HEADERS, aiBody } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";
import { getSet, inBackground, retryDueSets, setStatus } from "@/lib/sets";
import { normalizeScene } from "@/lib/venues";

/** A transparent pixel: what a set that's still coming paints, so the generic set shows through and nothing 404s. */
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * A drawn set (lib/sets.ts), by its place's normalized name. `x-set-status` says where it stands (the After Dark theater
 * preloads by it). A set that's drawing or will be tried again answers a transparent pixel, never cached, so the
 * browser logs no 404 while it comes and picks it up once it's ready; a set that isn't coming 404s (the generic set shows).
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const normalized = normalizeScene(decodeURIComponent(slug));
  const db = await getDb();
  const set = normalized ? await getSet(db, normalized) : null;
  if (set) {
    // ?w=… asks for the scene picker's card (app/after-dark/[a]/[b]/SetSceneModal.tsx): a small WebP, cached for a week.
    const thumb = new URL(req.url).searchParams.has("w") ? await thumbnail(set.data) : null;
    if (thumb) {
      return new Response(aiBody(thumb, "image/webp"), {
        headers: { "content-type": "image/webp", "x-set-status": "ready", "cache-control": "public, max-age=604800, stale-while-revalidate=2592000", ...AI_HEADERS },
      });
    }
    // Drawn by a model: marked AI-generated in its XMP (a set drawn before the mark gets it here) and its headers.
    return new Response(aiBody(set.data, set.mime), {
      headers: { "content-type": set.mime, "x-set-status": "ready", "cache-control": "public, max-age=86400, stale-while-revalidate=604800", ...AI_HEADERS },
    });
  }
  const status = normalized ? await setStatus(db, normalized) : "none";
  if (status === "drawing" || status === "retrying") {
    // Someone's waiting on it: check a kept picture again if one is due (Hive only, one at a time, never a new draw).
    if (status === "retrying") inBackground(() => retryDueSets(db, 1));
    return new Response(new Uint8Array(PIXEL), { headers: { "content-type": "image/gif", "x-set-status": status, "cache-control": "no-store" } });
  }
  return new Response("Not found", { status: 404, headers: { "x-set-status": status, "cache-control": "public, max-age=300" } });
}

/** The one width a card copy comes in, so ?w= can't mint endless variants. */
const THUMB_WIDTH = 400;

/** A WebP copy THUMB_WIDTH wide, or null (sharp unavailable or failing): then the full set goes out instead. */
async function thumbnail(bytes: Buffer): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(bytes).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
  } catch {
    return null;
  }
}

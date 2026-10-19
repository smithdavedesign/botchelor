import { getDb } from "@/lib/db";
import { getSet } from "@/lib/sets";
import { normalizeScene } from "@/lib/venues";

/** A drawn set (lib/sets.ts), by its place's normalized name. A 404 until it's drawn: the scene falls back to the generic set. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const normalized = normalizeScene(decodeURIComponent(slug));
  const set = normalized ? await getSet(await getDb(), normalized) : null;
  if (!set) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
  return new Response(new Uint8Array(set.data), {
    headers: { "content-type": set.mime, "cache-control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}

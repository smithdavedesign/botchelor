import { getDb } from "@/lib/db";
import { seasonIdFromSlug } from "@/lib/season-ref";
import { posterFormatOf, seasonPoster } from "../../season-poster";

export const dynamic = "force-dynamic";

/**
 * The season's poster as a file to post (app/seasons/season-poster.tsx): ?format=og (1200×630, the default), ph (1270×760,
 * a Product Hunt gallery image) or story (1080×1920, a phone story). Public, like the link preview it shares a layout with.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const id = seasonIdFromSlug((await params).slug);
  if (!id) return new Response("Not a season", { status: 404 });
  return seasonPoster(await getDb(), id, posterFormatOf(new URL(req.url).searchParams.get("format")));
}

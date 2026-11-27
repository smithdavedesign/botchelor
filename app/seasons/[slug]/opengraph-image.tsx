import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { seasonIdFromSlug } from "@/lib/season-ref";
import { POSTER_FORMATS, seasonPoster } from "../season-poster";

export const alt = "The season's poster: the lead, the suitors and when the roses are handed out";
export const size = POSTER_FORMATS.og;
export const contentType = "image/png";

/** A season page's link preview: its poster (app/seasons/season-poster.tsx). */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const id = seasonIdFromSlug((await params).slug);
  if (!id) notFound();
  return seasonPoster(await getDb(), id, "og");
}

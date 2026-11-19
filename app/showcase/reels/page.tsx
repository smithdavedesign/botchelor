import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { pageViewer } from "../viewer";
import { reelFeed } from "./feed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reels · Botchelor showcase",
  description: "The showcase one picture or clip at a time: swipe through original characters, then take one on a date.",
  // The showcase itself is the page to find; these are the same posts, one a screen.
  alternates: { canonical: "/showcase" },
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The showcase as reels (./feed.tsx, the same body as After Dark's /after-dark/showcase/reels). Its After Dark side
 * (`?side=after_dark`) is After Dark's page now: middleware.ts sends that address there before this runs.
 */
export default async function ReelsPage({ searchParams }: Props) {
  const db = await getDb();
  return reelFeed(db, await pageViewer(db), await searchParams);
}

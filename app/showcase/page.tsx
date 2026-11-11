import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/app/Icon";
import { myRequests } from "@/lib/showcase-social";
import { getDb } from "@/lib/db";
import { pageMetadata } from "@/lib/seo";
import { parseFilters } from "@/lib/showcase";
import ShowcaseBrowser from "./ShowcaseBrowser";
import { reelsQuery } from "./reels/reel-shared";
import { pageViewer } from "./viewer";
import ShowTabs from "@/app/ShowTabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Reels: pictures and clips from Botchelor's creators",
  description: "Pictures, clips and date reels of original characters, published by the people who made them. Filter by character, creator, pose, place and more.",
  path: "/showcase",
});

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };


/** The creator showcase (lib/showcase.ts, docs/PRDs/showcase.md): everything its creators chose to publish. */
export default async function ShowcasePage({ searchParams }: Props) {
  const db = await getDb();
  const viewer = await pageViewer(db);
  const sp = await searchParams;
  return (
    <div className="showcase-page page-wide">
      <ShowTabs active="/showcase" />
      <div className="showcase-head">
        {/* "Reels", the word on the show's tab (app/ShowTabs.tsx) and the one people type (/reels comes here). */}
        <h1>Reels</h1>
        {/* The same posts and filters, one a screen (app/showcase/reels). */}
        <Link href={`/showcase/reels${reelsQuery(sp)}`} className="button secondary small showcase-reels-link">
          <Icon name="play" /> Watch full screen
        </Link>
      </div>
      <p className="muted">Pictures, clips and date reels their creators chose to share. Everything here was made with AI, and every character is a fictional adult.</p>
      {viewer.id && (await myRequests(db, viewer.id)).length > 0 && (
        <p className="notice">
          📣 Someone wants to share a picture with one of your characters. <Link href="/showcase/requests">See what&apos;s waiting on you</Link>
        </p>
      )}
      <ShowcaseBrowser db={db} viewer={viewer} base="/showcase" filters={parseFilters(sp)} />
    </div>
  );
}

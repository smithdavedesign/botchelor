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
import StudioTabs from "@/app/studio/StudioTabs";
import { pgAccess } from "@/lib/studio/pg";
import type { Db } from "@/lib/db";
import { shared } from "@/lib/shared-cache";
import { showcaseFeature } from "@/lib/showcase-feature";
import ShowcaseFeature from "./ShowcaseFeature";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Gallery: reels, clips and pictures from Botchelor's creators",
  description: "Pictures, clips and date reels of original characters, published by the people who made them. Filter by character, creator, pose, place and more.",
  path: "/showcase",
});

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };


/**
 * The viewer's newest character whose Studio they may open (lib/studio/pg.ts pgAccess: the Studio's own rule, so the
 * button never leads to a page that isn't there). Null signed out, with no character, or while the Studio is closed.
 */
async function studioDoor(db: Db, viewerId: string | null): Promise<{ id: string; name: string } | null> {
  if (!viewerId) return null;
  try {
    const { rows } = await db.query<{ id: string; name: string }>(`select id, name from characters where owner_id = $1 order by created_at desc limit 1`, [viewerId]);
    const mine = rows[0];
    if (!mine) return null;
    return (await pgAccess(db, viewerId, mine.id)).ok ? mine : null;
  } catch {
    return null;
  }
}

/**
 * The creator showcase (lib/showcase.ts, docs/PRDs/showcase.md): everything its creators chose to publish. Only that:
 * the show's own clips of aired dates no longer lead it (David, 2026-11-18: "remove the clips from the show, no one
 * cares in the asset gallery"); they play on the home page and on their dates.
 */
export default async function ShowcasePage({ searchParams }: Props) {
  const db = await getDb();
  const viewer = await pageViewer(db);
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const studio = await studioDoor(db, viewer.id);
  // "Now showing" (lib/showcase-feature.ts): the gallery as it opens, nothing filtered, the same for everyone, so from
  // a few seconds' shared copy (lib/shared-cache.ts).
  const unfiltered = Object.values(filters).every((v) => v === undefined || v === false);
  const feature = unfiltered ? await shared("showcase:feature", () => showcaseFeature(db)) : null;
  return (
    <div className="showcase-page page-full">
      {/* The Studio door's first room (app/studio/StudioTabs.tsx, 2026-11-16): what everyone made, beside where it's made. */}
      <StudioTabs current="gallery" />
      <div className="showcase-head">
        {/* "Gallery" on the tab; /reels still comes here, and the full-screen view keeps that word. */}
        <h1>Gallery</h1>
        {/* The same posts and filters, one a screen (app/showcase/reels). */}
        <Link href={`/showcase/reels${reelsQuery(sp)}`} className="button secondary small showcase-reels-link">
          <Icon name="play" /> Watch full screen
        </Link>
      </div>
      <p className="muted">Pictures, clips and date reels their creators chose to share. Everything here was made with AI, and every character is a fictional adult.</p>
      {feature && <ShowcaseFeature reel={feature} />}
      {viewer.id && (await myRequests(db, viewer.id)).length > 0 && (
        <p className="notice">
          📣 Someone wants to share a picture with one of your characters. <Link href="/showcase/requests">See what&apos;s waiting on you</Link>
        </p>
      )}
      <ShowcaseBrowser db={db} viewer={viewer} base="/showcase" filters={filters} />
      {/* The way in, under the grid (the design system's Reels): anyone's characters can be here. */}
      <aside className="showcase-cta card">
        <div>
          <strong>Your characters can be in here too.</strong>
          <p className="muted small">
            {studio ? `Shoot pictures of ${studio.name} in the Studio, then share the ones you like.` : "Share a picture or a date reel from any of your characters' pages."}
          </p>
        </div>
        {/* Straight to their own Studio (app/studio/page.tsx), when it would open for them. */}
        {studio ? (
          <Link className="button small" href={`/studio?character=${encodeURIComponent(studio.id)}`} data-track="reels-studio">
            Open {studio.name}&apos;s Studio
          </Link>
        ) : (
          <Link className="button small" href="/create">
            Make your character
          </Link>
        )}
      </aside>
    </div>
  );
}

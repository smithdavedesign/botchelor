import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/app/Icon";
import { myRequests } from "@/lib/showcase-social";
import { getDb } from "@/lib/db";
import { pageMetadata } from "@/lib/seo";
import { parseFilters, sideOf } from "@/lib/showcase";
import { galleryShowClipsOn, listShowClips } from "@/lib/home-clip";
import { shortName } from "@/lib/names";
import { shared } from "@/lib/shared-cache";
import ShowClips from "./ShowClips";
import ShowcaseBrowser from "./ShowcaseBrowser";
import { reelsQuery } from "./reels/reel-shared";
import { pageViewer } from "./viewer";
import StudioTabs from "@/app/studio/StudioTabs";
import { pgAccess } from "@/lib/studio/pg";
import type { Db } from "@/lib/db";

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

/** The creator showcase (lib/showcase.ts, docs/PRDs/showcase.md): everything its creators chose to publish. */
export default async function ShowcasePage({ searchParams }: Props) {
  const db = await getDb();
  const viewer = await pageViewer(db);
  const sp = await searchParams;
  const filters = parseFilters(sp);
  // The show's own clips lead the safe side's first page (lib/home-clip.ts listShowClips): with no filter, or with a
  // character picked (then that character's dates). Any other filter is about creators' posts, so the row steps aside.
  const others = Object.entries(filters).filter(([k, v]) => v !== undefined && k !== "character" && k !== "page" && k !== "sort");
  const lead = galleryShowClipsOn() && sideOf(filters) === "pg" && (filters.page ?? 1) === 1 && others.length === 0;
  const [studio, clips, clipOf] = await Promise.all([
    studioDoor(db, viewer.id),
    lead ? shared(`showcase:show-clips:${filters.character ?? ""}`, () => listShowClips(db, { limit: 6, characterId: filters.character ?? null })).catch(() => []) : Promise.resolve([]),
    lead && filters.character ? db.query<{ name: string }>(`select name from characters where id = $1 and visibility = 'public'`, [filters.character]).then((r) => r.rows[0]?.name ?? null, () => null) : Promise.resolve(null),
  ]);
  return (
    <div className="showcase-page page-wide">
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
      {viewer.id && (await myRequests(db, viewer.id)).length > 0 && (
        <p className="notice">
          📣 Someone wants to share a picture with one of your characters. <Link href="/showcase/requests">See what&apos;s waiting on you</Link>
        </p>
      )}
      <ShowClips clips={clips} of={clipOf ? shortName(clipOf) : null} />
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

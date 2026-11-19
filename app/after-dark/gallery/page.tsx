import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Icon from "@/app/Icon";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { afterDarkDoors } from "@/lib/adult/doors";
import { canAfterDark } from "@/lib/adult/entitlement";
import { GALLERY_PAGE, GALLERY_TAB_LABEL, GALLERY_TABS, galleryCounts, galleryLimit, galleryTab, galleryVideos, type GalleryTab } from "@/lib/adult/gallery";
import { ownMedia } from "@/lib/adult/media";
import { ownReels } from "@/lib/adult/reels";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { currentHere, currentView } from "../view";
import GalleryTabs from "../GalleryTabs";
import LockedPreview from "../LockedPreview";
import GalleryGrid from "./GalleryGrid";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Gallery · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

/**
 * After Dark's Gallery (the design kit's Gallery screen, 2026-11-12): every picture, clip and video of the night this
 * person made, from every pair and every Studio shoot, in one place, with the same filters as a night's gallery. Each
 * one links back to its night (or its Studio). The tools (Fix, Keep going, export) stay where they were made. Someone
 * After Dark isn't open to gets the locked preview instead (app/after-dark/LockedPreview.tsx; David, 2026-11-16: "allow
 * them to ... give them a signup link"): blurred tiles and the way in, never a picture.
 *
 * In tabs since 2026-11-15 (lib/adult/gallery.ts): Videos, Pictures and Faces, each loading its own, `?n=` a page more
 * at a time. Since 2026-11-18 it's the Gallery's first room, Yours, beside Showcase (./showcase, for whoever may see it:
 * ../GalleryTabs.tsx), the full width of the screen, its clips playing by themselves once shown. Videos is one grid
 * (David, 2026-11-18: "we have reels and clips, really they are the same thing ... have one combined section ... still
 * offer the filtering at the top"): each night's video as one tile among the clips, the newest first, under one set of
 * filters, every tile tagged where it was made (a night or the Studio, lib/made-in.ts) and what kind of video it is.
 */
export default async function AfterDarkGalleryPage({ searchParams }: { searchParams: Promise<{ tab?: string; n?: string; source?: string }> }) {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  if (!(await canAfterDark(db, auth)).ok) return <LockedPreview kind="gallery" source={(await searchParams).source} next="/after-dark/gallery" />;
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const [here, doors] = await Promise.all([currentHere(), afterDarkDoors(db, auth!.userId)]);
  const head = (
    <>
      <GalleryTabs current="yours" showcase={doors.showcase} />
      <p className="kicker">
        <Icon name="moon" /> After Dark · private
      </p>
      <h1>Gallery</h1>
    </>
  );
  // Where only the scenes are allowed (lib/jurisdiction.ts) there are no pictures or videos to show.
  if (here.mode === "text_only") {
    return (
      <div className="after-dark-mode">
        <article className="after-dark">
          {head}
          <p>{here.reason}</p>
          <Link className="button" href="/after-dark">
            The scenes
          </Link>
        </article>
      </div>
    );
  }
  const owner = auth!.userId;
  const sp = await searchParams;
  const counts = await galleryCounts(db, owner);
  const tab = galleryTab(sp.tab, counts);
  const limit = galleryLimit(sp.n);
  const [own, reels] = await Promise.all([ownMedia(db, owner, limit, { withArchived: true, tab }), tab === "videos" ? ownReels(db, owner, limit) : []]);
  // Videos: the clips and the nights' videos as one list, newest first (the newest `limit` of both).
  const items = tab === "videos" ? galleryVideos(own, reels, limit) : own;
  const tabHref = (t: GalleryTab, n?: number) => `/after-dark/gallery?tab=${t}${n ? `&n=${n}` : ""}`;
  const more = counts[tab] > limit;
  const empty: Record<GalleryTab, ReactNode> = {
    videos: (
      <>
        No videos yet. Film a night from its theater (🎬), or make a picture move in a character&apos;s Studio; <Link href="/after-dark">pick a pair</Link> to
        start one.
      </>
    ),
    pictures: (
      <>
        Nothing yet. A night draws its own pictures as it goes; <Link href="/after-dark">pick a pair</Link> to start one.
      </>
    ),
    faces: <>No faces yet. A character&apos;s face and body are set up in their Studio, the first time they&apos;re drawn.</>,
  };
  return (
    <div className="after-dark-mode page-full">
      <article className="after-dark ad-gallery-page">
        {head}
        <p className="muted">
          Everything you&apos;ve made, newest first, each tagged where it was made: on one of your nights, or in the Studio. Blurred until tapped,
          as everything here is. To fix one or make it move, open where it was made.
        </p>
        <nav className="segmented ad-gallery-tabs" aria-label="Gallery">
          {GALLERY_TABS.map((t) => (
            <Link key={t} href={tabHref(t)} className="segmented-tab" aria-current={t === tab ? "page" : undefined} scroll={false} data-gallery-tab={t}>
              {GALLERY_TAB_LABEL[t]} <span className="segmented-count">{counts[t]}</span>
            </Link>
          ))}
        </nav>
        {items.length > 0 && (
          <section className="ad-gallery-section" aria-labelledby="ad-gallery-items">
            <h2 id="ad-gallery-items" className="sr-only">
              {GALLERY_TAB_LABEL[tab]}
            </h2>
            {/* Keyed by the tab: its filters start fresh on each. */}
            <GalleryGrid key={tab} items={items} />
          </section>
        )}
        {!items.length && (
          <p className="muted" data-gallery-empty>
            {empty[tab]}
          </p>
        )}
        {more && (
          <p>
            <Link className="button-ghost" href={tabHref(tab, limit + GALLERY_PAGE)} scroll={false} data-gallery-more>
              Show older
            </Link>
          </p>
        )}
      </article>
    </div>
  );
}

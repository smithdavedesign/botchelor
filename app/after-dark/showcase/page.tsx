import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Icon from "@/app/Icon";
import ShowcaseBrowser from "@/app/showcase/ShowcaseBrowser";
import { reelsQuery } from "@/app/showcase/reels/reel-shared";
import { pageViewer } from "@/app/showcase/viewer";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { parseFilters } from "@/lib/showcase";
import { showcasePaths } from "@/lib/showcase-paths";
import GalleryTabs from "../GalleryTabs";
import LockedPreview from "../LockedPreview";
import { currentHere, currentView } from "../view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Showcase · Gallery · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * After Dark's showcase (lib/showcase-paths.ts; David, 2026-11-18: "consolidate the after dark showcase in
 * ad.botchelor"): what creators published to After Dark's side, explicit posts only, on After Dark's own host as a room
 * of its Gallery (Yours | Showcase, ./GalleryTabs.tsx). The show's grid and filters (app/showcase/ShowcaseBrowser.tsx),
 * with links that stay here, under After Dark's own blur (the person's privacy setting) instead of the grid's veil.
 * Who sees it is the showcase's rule (lib/showcase.ts showcaseViewer: an admin, or anyone once explicit posts open);
 * anyone else in After Dark gets their own Gallery, and anyone After Dark isn't open to the locked preview, which shows
 * these same posts blurred.
 */
export default async function AfterDarkShowcasePage({ searchParams }: Props) {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  if (!(await canAfterDark(db, auth)).ok) return <LockedPreview kind="gallery" next="/after-dark/showcase" />;
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const viewer = await pageViewer(db);
  if (!viewer.ratings.includes("nsfw")) redirect("/after-dark/gallery");
  const here = await currentHere();
  const sp = await searchParams;
  const paths = showcasePaths("after_dark");
  const head = (
    <>
      <p className="kicker">
        <Icon name="moon" /> After Dark · showcase
      </p>
    </>
  );
  // Where only the scenes are allowed (lib/jurisdiction.ts) there are no pictures or videos to show.
  if (here.mode === "text_only") {
    return (
      <div className="after-dark-mode">
        <article className="after-dark">
          {head}
          <h1>Gallery</h1>
          <GalleryTabs current="showcase" showcase />
          <p>{here.reason}</p>
        </article>
      </div>
    );
  }
  return (
    <div className="after-dark-mode page-full">
      <article className="after-dark showcase-page ad-showcase-page">
        {head}
        <div className="showcase-head">
          <h1>Gallery</h1>
          {/* The same posts and filters, one a screen: the show's reels page, on this side (./reels). */}
          <Link href={`${paths.reels}${reelsQuery(sp)}`} className="button secondary small showcase-reels-link">
            <Icon name="play" /> Watch full screen
          </Link>
        </div>
        {/* Under the title, not above it (mobile audit C10). */}
        <GalleryTabs current="showcase" showcase />
        <p className="muted">
          What creators chose to publish to After Dark: explicit pictures and clips. Everything here was made with AI, and every character is a fictional adult.
        </p>
        <ShowcaseBrowser db={db} viewer={viewer} base={paths.base} filters={parseFilters(sp)} fixed={{ side: "after_dark" }} place="after_dark" />
      </article>
    </div>
  );
}

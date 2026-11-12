import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/app/Icon";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { ownMedia } from "@/lib/adult/media";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { currentHere, currentView } from "../view";
import GalleryGrid from "./GalleryGrid";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Gallery · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

/**
 * After Dark's Gallery (the design kit's Gallery screen, 2026-11-12): every picture, clip and video of the night this
 * person made, from every pair and every Studio shoot, in one place, with the same filters as a night's gallery. Each
 * one links back to its night (or its Studio). The tools (Fix, Keep going, export) stay where they were made. Not
 * found for anyone After Dark isn't open to, as the hub.
 */
export default async function AfterDarkGalleryPage() {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  if (!(await canAfterDark(db, auth)).ok) notFound();
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const here = await currentHere();
  const head = (
    <>
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
  const items = await ownMedia(db, auth!.userId, 120, { withArchived: true });
  return (
    <div className="after-dark-mode">
      <article className="after-dark ad-gallery-page">
        {head}
        <p className="muted">
          Every picture, clip and video from your nights and your Studio shoots, newest first. Blurred until tapped, as everything here is. To fix
          one or make it move, open its night.
        </p>
        {items.length ? (
          <GalleryGrid items={items} />
        ) : (
          <p className="muted" data-gallery-empty>
            Nothing yet. A night draws its own pictures as it goes; <Link href="/after-dark">pick a pair</Link> to start one.
          </p>
        )}
      </article>
    </div>
  );
}

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eligibleIds } from "@/lib/adult/characters";
import { afterDarkTitle, OWN_VEIL_ATTR } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { reelFeed } from "@/app/showcase/reels/feed";
import { reelsQuery } from "@/app/showcase/reels/reel-shared";
import { pageViewer } from "@/app/showcase/viewer";
import { currentView } from "../../view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Reels · Showcase · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * After Dark's showcase as reels (lib/showcase-paths.ts; David, 2026-11-18): the show's reels page itself
 * (app/showcase/reels/feed.tsx, ReelFeed unchanged: "keep the reel page as is, I like it"), on After Dark's side, served
 * from After Dark's host. Anyone that side isn't open to gets the safe side's reels on the show, as a shared After Dark
 * reel always did. The feed keeps its own veil (blurred until a tap shows the feed), so After Dark's per-picture blur
 * steps aside for it (lib/adult/discreet.ts OWN_VEIL_ATTR).
 */
export default async function AfterDarkShowcaseReelsPage({ searchParams }: Props) {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const sp = await searchParams;
  const viewer = await pageViewer(db);
  const safe = `/showcase/reels${reelsQuery({ ...sp, side: undefined })}`;
  if (!(await canAfterDark(db, auth)).ok || !viewer.ratings.includes("nsfw")) redirect(safe);
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  // Who a night can start with (this viewer's After Dark cast): their button opens their After Dark page, never the show's.
  const nights = [...(await eligibleIds(db, auth!.userId))];
  const feed = await reelFeed(db, viewer, { ...sp, side: "after_dark" }, "after_dark", { nights });
  return <div {...{ [OWN_VEIL_ATTR]: "reels" }}>{feed}</div>;
}

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { SHARE_IMAGE } from "@/lib/seo";
import { getRoomState } from "@/lib/watch";
import WatchRoom from "./WatchRoom";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ start?: string | string[] }> };

/**
 * A room replays one episode, so search engines are pointed at the episode page as the canonical copy (one
 * indexable URL per date, no duplicate content); the room itself stays out of the index but its links count.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const state = await getRoomState(await getDb(), id, null).catch(() => null);
  if (!state) return { title: "Date room not found · Botchelor", robots: { index: false, follow: false } };
  const [a, b] = state.characters;
  const title = `Watch ${a.name} × ${b.name} live · Botchelor`;
  const description = `A blind date between two original characters, playing live: ${state.setting} React, chat and predict how it ends.`.slice(0, 200);
  return {
    title,
    description,
    alternates: { canonical: `/episodes/${state.episode_id}` },
    robots: { index: false, follow: true },
    // Setting openGraph replaces the root layout's, share card included, so the card is named here (lib/seo.ts).
    openGraph: { title, description, type: "video.episode", siteName: "Botchelor", locale: "en_US", images: [SHARE_IMAGE] },
  };
}

/** A synchronized "date room": the pre-generated date plays on one shared clock, with live reactions,
 * chat and audience polls. The audience reacts and predicts; it never steers the characters. */
export default async function WatchRoomPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  const [state, engaged] = await Promise.all([
    getRoomState(db, id, viewerId),
    // A viewer with characters of their own (the nav's own test, app/layout.tsx) came for the show, not by accident.
    viewerId ? db.query(`select 1 from characters where owner_id = $1 and not is_house limit 1`, [viewerId]).then((r) => r.rows.length > 0, () => false) : false,
  ]);
  if (!state) notFound();
  // A waiting open room starts on arrival only for someone who meant it: the lobby's Start button (?start=1) or a
  // viewer with characters; anyone else gets a Start button (the audit, 2026-11-11, 2.7: page loads were starting dates).
  const autoStart = state.clock.started || sp.start === "1" || engaged;
  return <WatchRoom initial={state} autoStart={autoStart} />;
}

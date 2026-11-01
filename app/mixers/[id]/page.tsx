import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import CharacterName from "@/app/CharacterName";
import { airIfDue } from "@/lib/air";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { mixerNightView } from "@/lib/mixer-night";
import { venueBackdrop } from "@/lib/portraits";
import { venueBackdropCss, venueName, venuePhrase } from "@/lib/venues";
import MixerNight from "./MixerNight";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const view = await mixerNightView(await getDb(), id, null).catch(() => null);
  if (!view) return { title: "A mixer · Botchelor", robots: { index: false, follow: false } };
  return {
    title: `The mixer at ${venueName(view.venue)} · Botchelor`,
    description: `${view.seats.length} singles, one room, ${view.rounds} rounds of speed dates: an AI-written night on Botchelor.`,
    alternates: { canonical: `/mixers/${id}` },
    robots: { index: false, follow: true },
  };
}

/**
 * A mixer night as one room (lib/mixer-room.ts, David 2026-11-01): everyone seated from the start, the bell's rounds in
 * order with each pair's six lines and the room's beats around them, then who leaves with whom. Each table is still its
 * own episode (endings, matches, second dates and texts are per pair) and links to its own page; this page reads each
 * as the viewer may see it (lib/mixer-night.ts), so nothing unaired or private shows here that wouldn't show there.
 */
export default async function MixerNightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  // Opening the night airs any table whose prediction window has closed, like opening that table's own page.
  const eps = (await db.query<{ episode_id: string }>(
    `select r->>'episode_id' as episode_id from group_nights gn, jsonb_array_elements(coalesce(gn.rotations, '[]'::jsonb)) r
      where gn.id = $1 and gn.kind = 'mixer' and r->>'episode_id' is not null`,
    [id],
  ).catch(() => ({ rows: [] as { episode_id: string }[] }))).rows;
  for (const e of eps) await airIfDue(db, e.episode_id).catch(() => null);
  const view = await mixerNightView(db, id, viewerId);
  if (!view || view.status === "cancelled") notFound();

  const photo = venueBackdrop(view.venue);
  const background = [
    "linear-gradient(180deg, rgba(14,8,20,0.20) 0%, rgba(14,8,20,0.55) 45%, rgba(14,8,20,0.92) 100%)",
    photo ? `url(${photo})` : null,
    venueBackdropCss(view.venue),
  ]
    .filter(Boolean)
    .join(", ");
  const houseRun = view.seats.filter((s) => s.house_run);
  return (
    <article className="episode-page mixer-page">
      <header className={`episode-hero${photo ? "" : " no-photo"}`} style={{ backgroundImage: background }}>
        <div className="episode-hero-inner">
          <p className="episode-hero-kicker">
            <span>Botchelor</span>
            <span>{venueName(view.venue)}</span>
          </p>
          <ul className="mixer-roster" aria-label="Who's in the room">
            {view.seats.map((s) => (
              <li key={s.id}>
                <Avatar seed={s.id} name={s.name} hue={s.hue} house={s.house} portraitSrc={s.portrait} size={56} />
                <span className="mixer-roster-name">
                  <CharacterName character={s} avatar={false} />
                  {s.house_run && <span className="mixer-house-tag" title="Played by the show: one of the house's own characters">House</span>}
                </span>
              </li>
            ))}
          </ul>
          <h1>🍸 The mixer at {venuePhrase(view.venue)}</h1>
          <p className="episode-hero-setting">{view.opening}</p>
          <ul className="episode-hero-chips" aria-label="About this night">
            <li>AI-generated</li>
            <li>One room</li>
            <li>{view.seats.length} singles</li>
            {view.rounds > 0 && <li>{view.rounds} rounds</li>}
            {houseRun.length > 0 && <li>{houseRun.length === 1 ? "1 house character" : `${houseRun.length} house characters`}</li>}
          </ul>
        </div>
      </header>

      <div className="episode-body">
        {view.status === "open" ? (
          <p className="notice">The doors are open: this mixer runs once enough singles are in. Put one of yours in from its character card.</p>
        ) : (
          <MixerNight tables={view.tables} rounds={view.rounds} closing={view.closing} />
        )}
        {houseRun.length > 0 && (
          <p className="muted small">
            House characters are the show&apos;s own, played by the show: {houseRun.map((s) => s.name).join(", ")}.
          </p>
        )}
        <p className="muted small">
          Each table is its own date, with its own ending; whoever wants another can have it. <Link href="/matches">Your matches</Link>
        </p>
      </div>
    </article>
  );
}

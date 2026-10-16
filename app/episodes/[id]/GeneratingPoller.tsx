"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Scene from "@/app/Scene";
import type { CharacterRef } from "@/lib/game";
import type { VenueId } from "@/lib/venues";

/** The creator who just sent the date: wait on the theater stage itself, and play the date the moment it's filmed. */
type Stage = { characters: [CharacterRef, CharacterRef]; venue: VenueId | null };

/**
 * M10 part 2: while an episode is 'generating', poll its status and refresh the page the moment the
 * background worker finishes. If the episode disappears (404), generation failed terminally — the date
 * was given back — so offer another try. No websockets; a light poll, like the watch room.
 */
export default function GeneratingPoller({ episodeId, stage }: { episodeId: string; stage?: Stage }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}`, { cache: "no-store" });
        if (res.status === 404) {
          if (active) setFailed(true);
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as { status?: string };
          if (data.status && data.status !== "generating") {
            // On the stage, go straight into the playback; otherwise just show the finished episode.
            if (stage) router.replace(`/episodes/${episodeId}?play=1`);
            else router.refresh();
            return;
          }
        }
      } catch {
        /* a dropped poll is harmless; the next one catches up */
      }
      if (active) timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 2500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [episodeId, router, failed, stage]);

  if (failed) {
    return (
      <section className="card">
        <h2>That date didn&apos;t work out</h2>
        <p className="muted">
          The filming didn&apos;t come together this time, and your date has been given back. Send them
          out again.
        </p>
        <p>
          <Link href="/">Make another date</Link>
        </p>
      </section>
    );
  }

  if (stage) {
    const [a, b] = stage.characters;
    return (
      <div className="theater theater-clean theater-filming">
        <div className="theater-stage">
          <div className="theater-scene-area">
            <Scene characters={stage.characters} venue={stage.venue} lineA={null} lineB={null} actLabel="Filming" placeholder="They're arriving…" />
          </div>
          <header className="theater-hud">
            <div className="theater-id">
              <strong>
                {a.name} <span className="vs">×</span> {b.name}
              </strong>
              <span className="chip">🎬 Filming</span>
            </div>
            <div className="theater-tools">
              <Link href={`/episodes/${episodeId}`} className="button secondary small">
                Exit
              </Link>
            </div>
          </header>
          <div className="theater-verdict" role="status" aria-live="polite">
            <p className="ending">Filming the date…</p>
            <p className="muted">It starts playing here the moment it&apos;s ready, usually under a minute.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="card watch-preshow" aria-live="polite">
      <h2>🎬 Filming the date…</h2>
      <p className="muted">
        The two characters are on their date right now. This usually takes a few seconds — the page will
        update itself the moment it&apos;s ready.
      </p>
    </section>
  );
}

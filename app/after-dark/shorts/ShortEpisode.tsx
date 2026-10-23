"use client";

import { useState } from "react";
import Avatar from "@/app/Avatar";
import AfterDarkTheater from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import { requestJson } from "@/app/request";
import type { ShortEpisode as Episode, ShortView } from "@/lib/adult/shorts";
import type { CharacterRef } from "@/lib/game";
import ShortVideo from "./ShortVideo";
import styles from "./shorts.module.css";

/**
 * A Short's night (lib/adult/shorts.ts). Until the viewer presses play the page has none of it: ▶ Play records the
 * view and brings the night back, then opens it in the theater. After that: the theater again, the night's video when
 * it has one, and the night to read, chapter by chapter.
 */
export default function ShortEpisode({ id, characters, initial }: { id: string; characters: [CharacterRef, CharacterRef]; initial: Episode | null }) {
  const [episode, setEpisode] = useState(initial);
  const [theater, setTheater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = (who: "a" | "b") => (who === "a" ? characters[0] : characters[1]).name.split(/\s+/)[0];

  async function play() {
    if (episode) return setTheater(true);
    setBusy(true);
    setError(null);
    const res = await requestJson(`/api/admin/after-dark/shorts/${encodeURIComponent(id)}/watch`).catch(() => null);
    setBusy(false);
    const next = (res?.data.short as ShortView | undefined)?.episode;
    if (!res?.ok || !next) return setError(res?.message ?? "That didn't load. Try again.");
    setEpisode(next);
    setTheater(true);
  }

  const lines = episode ? episode.chapters.flatMap((c) => c.lines) : [];
  return (
    <section>
      <p>
        <button type="button" className="primary" disabled={busy} onClick={() => void play()}>
          {busy ? "Loading…" : episode ? "🎬 Watch in theater" : "▶ Play"}
        </button>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {theater && episode && (
        <AfterDarkTheater
          scene={{ lines, place: episode.place, stage: episode.stage, dateVenue: episode.date_venue, set: episode.set }}
          characters={characters}
          onExit={() => setTheater(false)}
        />
      )}
      {episode && (
        <>
          {episode.video.length > 0 && (
            <section>
              <h2>The night&apos;s video</h2>
              <ShortVideo shots={episode.video} />
            </section>
          )}
          <section>
            <h2>The night</h2>
            {episode.chapters.map((c) => (
              <section key={c.chapter} className={styles.chapter} aria-label={`Chapter ${c.chapter}`}>
                <h3>
                  Chapter {c.chapter}
                  {c.place ? <span className="muted small"> · ended {c.place}</span> : null}
                </h3>
                <ol className="after-dark-lines">
                  {c.lines.map((l, i) => {
                    const who = l.who === "a" ? characters[0] : characters[1];
                    return (
                      <li key={i} className={`after-dark-line is-${l.who}`}>
                        <Avatar seed={who.id} name={who.name} hue={who.hue} house={who.house} portraitSrc={who.portrait} size={34} />
                        <p>
                          <strong>{first(l.who)}</strong> {l.text}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </section>
        </>
      )}
    </section>
  );
}

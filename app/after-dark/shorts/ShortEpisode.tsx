"use client";

import { useState } from "react";
import Avatar from "@/app/Avatar";
import AfterDarkTheater from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import { requestJson } from "@/app/request";
import type { Call, Outcome } from "@/lib/adult/predictions";
import type { ShortEpisode as Episode, ShortView } from "@/lib/adult/shorts";
import type { CharacterRef } from "@/lib/game";
import { CallIt, Reveal } from "./CallIt";
import ShortVideo from "./ShortVideo";
import styles from "./shorts.module.css";

/**
 * A Short's night (lib/adult/shorts.ts). Until the viewer presses play the page has none of it, only the Call it card
 * (lib/adult/predictions.ts) when they can call it: ▶ Play records the view, which locks the call and settles it from
 * the recorded night, and brings the night back, then opens it in the theater. After that: how the call went, the
 * theater again, the night's video when it has one, and the night to read, chapter by chapter.
 */
export default function ShortEpisode({
  id,
  characters,
  initial,
  canCall = false,
  call: firstCall = null,
  outcome: firstOutcome = null,
  owner = false,
  boardLabel = null,
}: {
  id: string;
  characters: [CharacterRef, CharacterRef];
  initial: Episode | null;
  /** Whether this viewer may call it (published, not theirs, not an admin's, not watched). */
  canCall?: boolean;
  call?: Call | null;
  /** What happened: only once the night is theirs to see (after play, or theirs). */
  outcome?: Outcome | null;
  owner?: boolean;
  boardLabel?: string | null;
}) {
  const [episode, setEpisode] = useState(initial);
  const [call, setCall] = useState(firstCall);
  const [outcome, setOutcome] = useState(firstOutcome);
  const [theater, setTheater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = (who: "a" | "b") => (who === "a" ? characters[0] : characters[1]).name.split(/\s+/)[0];
  const names = { a: first("a"), b: first("b") };

  async function play() {
    if (episode) return setTheater(true);
    setBusy(true);
    setError(null);
    const res = await requestJson(`/api/admin/after-dark/shorts/${encodeURIComponent(id)}/watch`).catch(() => null);
    setBusy(false);
    const next = (res?.data.short as ShortView | undefined)?.episode;
    if (!res?.ok || !next) return setError(res?.message ?? "That didn't load. Try again.");
    setCall((res.data.call as Call | null) ?? null);
    setOutcome((res.data.outcome as Outcome | null) ?? null);
    setEpisode(next);
    setTheater(true);
  }

  const lines = episode ? episode.chapters.flatMap((c) => c.lines) : [];
  return (
    <section>
      {!episode && canCall && <CallIt id={id} names={names} initial={call} onCall={setCall} />}
      <p>
        <button type="button" className="primary" disabled={busy} onClick={() => void play()}>
          {busy ? "Loading…" : episode ? "🎬 Watch in theater" : "▶ Play"}
        </button>
        {!episode && canCall && <span className="muted small"> {call ? " Your call locks when it plays." : " Pressing play closes calls on it."}</span>}
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
      {episode && outcome && <Reveal names={names} call={call} outcome={outcome} boardLabel={boardLabel} owner={owner} />}
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

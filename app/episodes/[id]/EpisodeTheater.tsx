"use client";

import { useEffect, useState } from "react";
import Scene, { SceneThread } from "@/app/Scene";
import { DATE_ACTS } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import type { VenueId } from "@/lib/venues";

type Props = {
  characters: [CharacterRef, CharacterRef];
  venue: VenueId | null;
  transcript: Turn[];
  endingLabel: string;
};

// Pace the replay like it aired: a steady beat within an act, a longer dramatic pause when the act turns
// over (first impressions → the challenge → the decision). Deterministic from each turn's act, so a replay
// relays the conversation the way a live viewer saw it unfold, not as a uniform ticker.
const TURN_MS = 2100;
const ACT_BREAK_MS = 3400;

function lastOf(turns: Turn[], side: "a" | "b"): string | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].side === side) return turns[i].dialogue;
  return null;
}

/** How long to wait before revealing the turn at `pos` (the one about to appear). */
function delayBefore(transcript: Turn[], pos: number): number {
  const next = transcript[pos];
  const prev = transcript[pos - 1];
  return pos > 0 && next && prev && next.act > prev.act ? ACT_BREAK_MS : TURN_MS;
}

/**
 * M13 — the episode's cinematic replay. The same immersive scene as the live theater, but it plays the
 * recorded transcript back on a timer (the "window into the date" for a date that already happened). The
 * readable transcript stays on the page as the record; this is the experience on top.
 */
export default function EpisodeTheater({ characters, venue, transcript, endingLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(0); // how many turns have played
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!open || !playing) return;
    if (pos >= transcript.length) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setPos((p) => p + 1), delayBefore(transcript, pos));
    return () => clearTimeout(timer);
  }, [open, playing, pos, transcript.length]);

  function enter() {
    setPos(0);
    setPlaying(true);
    setOpen(true);
  }
  function restart() {
    setPos(0);
    setPlaying(true);
  }

  if (!open) {
    return (
      <button type="button" className="primary" onClick={enter}>
        🎬 Watch in theater
      </button>
    );
  }

  const shown = transcript.slice(0, pos);
  const [a, b] = characters;
  const actLabel = shown.length ? DATE_ACTS[shown[shown.length - 1].act] ?? null : null;
  const done = pos >= transcript.length;

  return (
    <div className="theater chat-closed">
      <div className="theater-stage">
        <Scene
          characters={characters}
          venue={venue}
          lineA={lastOf(shown, "a")}
          lineB={lastOf(shown, "b")}
          actLabel={actLabel}
          placeholder="The date begins…"
        />
        <SceneThread characters={characters} turns={shown} />

        <header className="theater-hud">
          <div className="theater-id">
            <strong>
              {a.name} <span className="vs">×</span> {b.name}
            </strong>
          </div>
          <div className="theater-tools">
            <button
              type="button"
              className="theater-icon"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play"}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button type="button" className="theater-icon" onClick={restart} aria-label="Restart" title="Restart">
              ↻
            </button>
            <button type="button" className="secondary small" onClick={() => { setOpen(false); setPlaying(false); }}>
              Exit
            </button>
          </div>
        </header>

        {done && (
          <div className="theater-verdict">
            <p className="ending">{endingLabel}</p>
            <p className="muted">
              That&apos;s how it ended.{" "}
              <button type="button" className="linklike" onClick={restart}>
                Watch again
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

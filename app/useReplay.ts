"use client";

import { useEffect, useRef, useState } from "react";
import type { Turn } from "@/lib/conversation";

// Pace a replay like it aired: a steady beat within an act, a longer dramatic pause when the act turns over
// (first impressions → the challenge → the decision). Deterministic from each turn's act, so a replay relays
// the conversation the way a live viewer saw it unfold, not as a uniform ticker.
export const TURN_MS = 2600;
export const ACT_BREAK_MS = 4000;
/** The opening line comes quickly, so pressing play feels like the date starts right away. */
export const FIRST_MS = 900;
/** After a line that was held while it was said aloud, the next comes this soon. */
export const HELD_BEAT_MS = 600;

/** How long to wait before revealing the turn at `pos` (the one about to appear). */
export function delayBefore(transcript: Turn[], pos: number): number {
  if (pos === 0) return FIRST_MS;
  const next = transcript[pos];
  const prev = transcript[pos - 1];
  return next && prev && next.act > prev.act ? ACT_BREAK_MS : TURN_MS;
}

export type Replay = {
  /** The turns revealed so far. */
  shown: Turn[];
  playing: boolean;
  done: boolean;
  /** Who is "typing" the next line while playback runs (not across an act break), else null. */
  typing: "a" | "b" | null;
  toggle: () => void;
  restart: () => void;
  /** Jump straight to the end (the whole conversation + the ending). */
  skip: () => void;
  /**
   * Jump to the newest line and keep playing: a live transcript's next lines then play as they arrive (After Dark's
   * Next during playback, #1061's e2e: skip() paused it, so the step Next asked for never reached the stage).
   */
  catchUp: () => void;
};

/**
 * Plays a recorded transcript back on a timer: the episode replay and a finished watch room both use it, so
 * a date that already happened plays out line by line exactly like a live one.
 */
export function useReplay(
  transcript: Turn[],
  autoplay = true,
  /**
   * `live`: the transcript is still being written (a date being filmed). Playback never finishes; it waits at
   * the newest line and carries on as more arrive. `startAt`: open with that many lines already shown (the
   * creator watched them live, so the finished date picks up where they were).
   */
  opts: { live?: boolean; startAt?: number; hold?: boolean } = {},
): Replay {
  const live = opts.live ?? false;
  const [pos, setPos] = useState(() => Math.max(0, Math.min(opts.startAt ?? 0, transcript.length)));
  const [playing, setPlaying] = useState(autoplay);
  const done = !live && pos >= transcript.length;

  // Keyed on the length, not the array: a live room hands us a fresh (identical) array on every poll, and
  // re-arming the timer each time would stall playback at the longer act breaks.
  const latest = useRef(transcript);
  latest.current = transcript;
  const total = transcript.length;
  // `hold`: the line on screen is still being said (After Dark's Listen), so the next one waits for it, then comes a beat
  // after it ends rather than a whole turn's pause.
  const hold = opts.hold ?? false;
  const held = useRef(false);
  useEffect(() => {
    if (!playing) return;
    if (hold) {
      held.current = true;
      return;
    }
    if (pos >= total) {
      if (!live) setPlaying(false);
      return;
    }
    const wait = held.current ? HELD_BEAT_MS : delayBefore(latest.current, pos);
    held.current = false;
    const timer = setTimeout(() => setPos((p) => p + 1), wait);
    return () => clearTimeout(timer);
  }, [playing, pos, total, live, hold]);

  const next = transcript[pos];
  const prev = transcript[pos - 1];
  const typing = playing && next && (!prev || prev.act === next.act) ? next.side : null;

  return {
    shown: transcript.slice(0, pos),
    playing,
    done,
    typing,
    toggle: () => {
      if (done) {
        setPos(0);
        setPlaying(true);
      } else setPlaying((p) => !p);
    },
    restart: () => {
      setPos(0);
      setPlaying(true);
    },
    skip: () => {
      setPos(transcript.length);
      setPlaying(false);
    },
    catchUp: () => {
      setPos(transcript.length);
      setPlaying(true);
    },
  };
}

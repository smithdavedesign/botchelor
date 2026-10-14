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
};

/**
 * Plays a recorded transcript back on a timer: the episode replay and a finished watch room both use it, so
 * a date that already happened plays out line by line exactly like a live one.
 */
export function useReplay(transcript: Turn[], autoplay = true): Replay {
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const done = pos >= transcript.length;

  // Keyed on the length, not the array: a live room hands us a fresh (identical) array on every poll, and
  // re-arming the timer each time would stall playback at the longer act breaks.
  const latest = useRef(transcript);
  latest.current = transcript;
  const total = transcript.length;
  useEffect(() => {
    if (!playing) return;
    if (pos >= total) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setPos((p) => p + 1), delayBefore(latest.current, pos));
    return () => clearTimeout(timer);
  }, [playing, pos, total]);

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
  };
}

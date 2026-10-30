"use client";

import { useEffect, useRef, useState } from "react";

/** Under the voices: present, never in the way. */
const VOLUME = 0.22;
/** A place's sound fades in, and the last one out, over this long. */
const FADE_MS = 1500;
/** While a place's sound is being made, asked again this often, this many times: Venice took about 9 minutes over one. */
const POLL_MS = 20_000;
const POLLS = 36;

type Answer = { status: "ready"; id: string } | { status: "making" | "off" | "failed" | "none" };

/**
 * The sound of the place on stage (lib/adult/place-sounds.ts; docs/PRDs/theater-immersion.md #6): while 🔈 is on and the
 * theater is playing, a quiet loop of where they are, faded across when they move. Renders nothing.
 */
export default function PlaceSound({ venue, on, playing }: { venue: string | null; on: boolean; playing: boolean }) {
  const [id, setId] = useState<string | null>(null);
  // The place's sound: asked for when 🔈 is on, and again while it's being made.
  useEffect(() => {
    if (!on || !venue) return setId(null);
    let live = true;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = () =>
      fetch(`/api/admin/after-dark/place-sound?venue=${encodeURIComponent(venue)}`)
        .then((r) => (r.ok ? (r.json() as Promise<Answer>) : null))
        .then((a) => {
          if (!live || !a) return;
          if (a.status === "ready") setId(a.id);
          else if (a.status === "making" && polls++ < POLLS) timer = setTimeout(ask, POLL_MS);
        })
        .catch(() => {});
    setId(null);
    void ask();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [venue, on]);

  // One looping player per sound; a new one fades in as the last fades out.
  const current = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const was = current.current;
    current.current = null;
    if (was) fade(was, 0, () => was.pause());
    if (!id) return;
    const el = new Audio(`/api/admin/after-dark/place-sound/${encodeURIComponent(id)}`);
    el.loop = true;
    el.volume = 0;
    current.current = el;
    return () => {
      if (current.current === el) {
        current.current = null;
        fade(el, 0, () => el.pause());
      }
    };
  }, [id]);

  // Heard while the theater plays; paused with it.
  useEffect(() => {
    const el = current.current;
    if (!el) return;
    if (playing) {
      void el.play().then(() => fade(el, VOLUME)).catch(() => {});
    } else el.pause();
  }, [playing, id]);

  return null;
}

/** A volume ramp to `to` over FADE_MS, then `done`. */
function fade(el: HTMLAudioElement, to: number, done?: () => void) {
  const from = el.volume;
  const start = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - start) / FADE_MS);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

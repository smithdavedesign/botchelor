"use client";

import { useSyncExternalStore } from "react";

/**
 * The showcase's one sound switch (David, 2026-11-09: "videos should have sound and by default muted but a user can
 * unmute them then all should have sound like reddit or tiktok"): every clip starts muted; once someone turns sound on,
 * every clip after it plays with sound, in the grid, its viewer and the reels, until they turn it off again.
 *
 * Kept for the page's life only (not storage): a browser lets a clip play with sound by itself only after a tap on the
 * page, so a reload starts muted again, as TikTok's and Reddit's do. One clip is heard at a time: the one that last
 * started playing (`playClip`, `soleSound`).
 */
let on = false;
const subs = new Set<() => void>();

export function setSound(next: boolean) {
  if (next === on) return;
  on = next;
  for (const f of subs) f();
}

export function soundOn(): boolean {
  return on;
}

/** The switch, for a component: [on, set]. Muted on the server and on first paint. */
export function useSound(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => on,
    () => false,
  );
  return [value, setSound];
}

/** Mutes every other showcase clip, so only `v` is heard. */
export function soleSound(v: HTMLVideoElement) {
  if (v.muted) return;
  document.querySelectorAll<HTMLVideoElement>("video[data-sound]").forEach((o) => {
    if (o !== v) o.muted = true;
  });
}

/**
 * Plays a clip with sound if the switch is on. A browser that won't play sound before a tap (NotAllowedError) gets it
 * muted instead, and the switch goes back off, so the 🔇 shown is the truth.
 */
export async function playClip(v: HTMLVideoElement) {
  v.muted = !on;
  if (!v.muted) soleSound(v);
  try {
    await v.play();
  } catch (e) {
    if (v.muted || (e as Error)?.name !== "NotAllowedError") return;
    v.muted = true;
    setSound(false);
    await v.play().catch(() => {});
  }
}

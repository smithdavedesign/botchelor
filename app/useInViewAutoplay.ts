"use client";

import { useEffect } from "react";
import { BLURRED_MEDIA, DISCREET_ATTR, SHOWN_ATTR } from "@/lib/adult/discreet";
import { IN_VIEW, whichPlay } from "@/lib/autoplay";
import { playClip } from "@/app/showcase/sound";

/** On each <video> the hook looks after, inside its root. */
export const AUTOPLAY_ATTR = "data-autoplay";

/** Still hidden: the grid's own veil (data-veiled), or After Dark's privacy blur until it's tapped (lib/adult/discreet.ts). */
export function blurred(v: Element): boolean {
  return (v instanceof HTMLElement && v.dataset.veiled === "1") || Boolean(v.closest(`[${DISCREET_ATTR}="blur"]`) && v.matches(BLURRED_MEDIA));
}

/** Whether the hook is playing it, so a pointer or focus leaving its tile leaves it playing. */
export const autoplaying = (v: HTMLVideoElement): boolean => v.dataset.auto === "1";

/**
 * A showcase clip by the showcase's one sound switch (app/showcase/sound.ts: muted until it's on); any other clip as it
 * is, muted if the browser won't play it with sound before a tap.
 */
function start(v: HTMLVideoElement): void {
  if (v.hasAttribute("data-sound")) {
    void playClip(v);
    return;
  }
  v.play().catch(() => {
    if (v.muted) return;
    v.muted = true;
    v.play().catch(() => {});
  });
}

/**
 * Clips that play by themselves while they're mostly on screen (David, 2026-11-18: "on showcase pages, videos should
 * play on hover or automatically preferably"), on every screen, not only a touch one: muted and looping, the most
 * visible first and at most MAX_PLAYING at once (lib/autoplay.ts), each paused once it's off screen. Never with reduced
 * motion (then hover and focus only, as before), never while blurred (it starts once tapped), and one the person
 * paused stays paused until it leaves the screen. `on`: false pauses them (a viewer open over the grid).
 *
 * The clips are the root's <video data-autoplay> (AUTOPLAY_ATTR), found again as the grid changes. `root`: the element
 * itself (a callback ref's, kept in state), so a grid that comes and goes with its filters is picked up each time. A
 * hover or a focus still plays a clip at once (the grid's own handlers); leaving it stops only a clip this didn't start.
 */
export function useInViewAutoplay(root: HTMLElement | null, on = true): void {
  useEffect(() => {
    const el = root;
    if (!el || typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return;
    const clips = () => [...el.querySelectorAll<HTMLVideoElement>(`video[${AUTOPLAY_ATTR}]`)];
    const halt = (v: HTMLVideoElement) => {
      // The mark goes first: the pause this causes isn't the person's.
      delete v.dataset.auto;
      v.pause();
    };
    if (!on || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      for (const v of clips()) if (autoplaying(v)) halt(v);
      return;
    }
    const ratio = new Map<HTMLVideoElement, number>();
    const settle = () => {
      const all = clips();
      const play = new Set(whichPlay(all.map((v) => ({ key: v, ratio: ratio.get(v) ?? 0, skip: blurred(v) || v.dataset.held === "1" }))));
      for (const v of all) {
        if (play.has(v)) {
          v.dataset.auto = "1";
          if (v.paused) start(v);
        } else if (autoplaying(v)) halt(v);
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          const r = e.isIntersecting ? e.intersectionRatio : 0;
          ratio.set(v, r);
          // Off the screen, one they paused may play again when it's back.
          if (r < IN_VIEW) delete v.dataset.held;
        }
        settle();
      },
      { threshold: [0, 0.25, 0.5, IN_VIEW, 0.75, 1] },
    );
    // `pause` doesn't bubble: heard on the way down. A pause of a clip this was playing is the person's (one this paused
    // and started again before the event came is playing, so it isn't).
    const onPause = (e: Event) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || !autoplaying(v) || !v.paused || v.ended) return;
      delete v.dataset.auto;
      v.dataset.held = "1";
    };
    const watched = new Set<HTMLVideoElement>();
    const sync = () => {
      const now = new Set(clips());
      for (const v of now) {
        if (watched.has(v)) continue;
        watched.add(v);
        io.observe(v);
      }
      for (const v of watched) {
        if (now.has(v)) continue;
        watched.delete(v);
        io.unobserve(v);
        ratio.delete(v);
      }
      settle();
    };
    el.addEventListener("pause", onPause, true);
    // New tiles, a tap that shows one (data-ad-shown), the veil lifted, a clip opted in or out: look again.
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: [SHOWN_ATTR, "data-veiled", AUTOPLAY_ATTR] });
    sync();
    return () => {
      io.disconnect();
      mo.disconnect();
      el.removeEventListener("pause", onPause, true);
      for (const v of watched) if (autoplaying(v)) halt(v);
    };
  }, [root, on]);
}

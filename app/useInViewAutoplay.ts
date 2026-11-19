"use client";

import { createContext, useCallback, useContext, useEffect } from "react";
import { IN_VIEW, whichPlay } from "@/lib/autoplay";
import { playClip } from "@/app/showcase/sound";

/** On each <video> the hook looks after, inside its root. */
export const AUTOPLAY_ATTR = "data-autoplay";

/** A grid's own veil on a clip (the show's showcase, app/showcase/ShowcaseGrid.tsx): `data-veiled="1"` until it's tapped. */
const GRID_VEIL = "data-veiled";

/**
 * What a page's own privacy veil hides, as its frame says: After Dark's blur until a tap (app/after-dark/AutoplayVeil.tsx,
 * in its frame). The hook knows nothing of After Dark (tests/adult-imports.test.ts): the page tells it. None on the show.
 */
export type AutoplayVeil = {
  /** Still hidden by the page's veil: never played until it's shown. */
  hides: (v: Element) => boolean;
  /** The attributes whose change can show or hide a clip (a tap that lifts the veil): looked at again when they change. */
  attrs: readonly string[];
};

const NO_VEIL: AutoplayVeil = { hides: () => false, attrs: [] };

export const AutoplayVeilContext = createContext<AutoplayVeil>(NO_VEIL);

/** Whether a clip is still hidden: the grid's own veil, or the page's (AutoplayVeil). Stable while the page's veil is. */
export function useHidden(): (v: Element) => boolean {
  const veil = useContext(AutoplayVeilContext);
  return useCallback((v: Element) => (v instanceof HTMLElement && v.getAttribute(GRID_VEIL) === "1") || veil.hides(v), [veil]);
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
 * motion (then hover and focus only, as before), never while hidden (useHidden: it starts once tapped), and one the
 * person paused stays paused until it leaves the screen. `on`: false pauses them (a viewer open over the grid).
 *
 * The clips are the root's <video data-autoplay> (AUTOPLAY_ATTR), found again as the grid changes. `root`: the element
 * itself (a callback ref's, kept in state), so a grid that comes and goes with its filters is picked up each time. A
 * hover or a focus still plays a clip at once (the grid's own handlers); leaving it stops only a clip this didn't start.
 */
export function useInViewAutoplay(root: HTMLElement | null, on = true): void {
  const veil = useContext(AutoplayVeilContext);
  const hidden = useHidden();
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
      const play = new Set(whichPlay(all.map((v) => ({ key: v, ratio: ratio.get(v) ?? 0, skip: hidden(v) || v.dataset.held === "1" }))));
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
    // New tiles, a veil lifted (the grid's, or the page's: a tap that shows one), a clip opted in or out: look again.
    // Never the hook's own marks (data-auto, data-held): setting one would call this again, and again.
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: [GRID_VEIL, AUTOPLAY_ATTR, ...veil.attrs] });
    sync();
    return () => {
      io.disconnect();
      mo.disconnect();
      el.removeEventListener("pause", onPause, true);
      for (const v of watched) if (autoplaying(v)) halt(v);
    };
  }, [root, on, veil, hidden]);
}

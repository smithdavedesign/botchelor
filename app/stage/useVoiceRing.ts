"use client";

import { useEffect, type RefObject } from "react";
import { voiceRing } from "@/lib/face-kit-shared";

/**
 * The ring around a character's face on a call, swelling with their voice (the call screens; app/ux/companion.css
 * "the voice's ring"): while they talk, how loud their voice is right now (`level`, 0..1, the player's own measure; under
 * 0 when it can't be measured, as the device's speech synthesis can't) is written to the element as `--voice` (0..1,
 * eased: lib/face-kit-shared.ts voiceRing) and it's marked `data-voice="live"`. That's how a call shows who's talking
 * now that the face is a living loop and no mouth is drawn to the words. With a voice that can't be measured the
 * element is left alone, and the stylesheet's own slow pulse stands in. Nothing is animated here with reduced motion:
 * the stylesheet shows a still ring.
 */
export function useVoiceRing(el: RefObject<HTMLElement | null>, level: () => number, on: boolean): void {
  useEffect(() => {
    const node = el.current;
    if (!on || !node || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let ring = 0;
    let live = false;
    const tick = () => {
      const heard = level();
      if (heard >= 0) {
        if (!live) {
          live = true;
          node.dataset.voice = "live";
        }
        const next = voiceRing(heard, ring);
        if (next !== ring) {
          ring = next;
          node.style.setProperty("--voice", String(next));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      delete node.dataset.voice;
      node.style.removeProperty("--voice");
    };
  }, [el, level, on]);
}

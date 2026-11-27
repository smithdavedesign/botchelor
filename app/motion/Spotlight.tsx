"use client";

import { useEffect } from "react";

/** The dark stages a spotlight follows the pointer across (app/ux/motion.css .spotlit). */
const STAGES = ".set-hero, .contestant-card";

/**
 * A soft follow spot on the show's dark title bands (2026-11-27): on a computer with a mouse, a pool of light trails the
 * pointer across a set hero or a contestant card, the way a stage light finds a face. One listener for the whole site,
 * mounted once in the layout; it only writes two CSS variables on the band under the pointer, once a frame. Nothing on a
 * touch screen, nothing under reduced motion, and the band is complete without it.
 */
export default function Spotlight() {
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let lit: HTMLElement | null = null;
    let frame = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      frame = 0;
      if (!lit) return;
      const r = lit.getBoundingClientRect();
      lit.style.setProperty("--spot-x", `${Math.round(x - r.left)}px`);
      lit.style.setProperty("--spot-y", `${Math.round(y - r.top)}px`);
    };
    const move = (e: PointerEvent) => {
      const stage = e.target instanceof Element ? (e.target.closest(STAGES) as HTMLElement | null) : null;
      if (stage !== lit) {
        lit?.classList.remove("spotlit");
        lit = stage;
        lit?.classList.add("spotlit");
      }
      x = e.clientX;
      y = e.clientY;
      if (lit && !frame) frame = requestAnimationFrame(paint);
    };
    const leave = () => {
      lit?.classList.remove("spotlit");
      lit = null;
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      document.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      if (frame) cancelAnimationFrame(frame);
      leave();
    };
  }, []);
  return null;
}

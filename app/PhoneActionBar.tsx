"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The page's main action, in thumb reach on a phone (UX round C, 2026-11-07): once the element with id `watch` (the
 * page's own call to action) has scrolled up out of view, the same action floats at the bottom of the screen, left of
 * the feedback button. Phones only (CSS hides it from 721px); nothing shows until the original is gone, so it never
 * doubles up on screen.
 */
export default function PhoneActionBar({ watch, children }: { watch: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = document.getElementById(watch);
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [watch]);
  return (
    <div className={`phone-action-bar${shown ? " shown" : ""}`} aria-hidden={!shown} inert={!shown}>
      {children}
    </div>
  );
}

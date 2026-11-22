"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Where a pinned column's top sits: under the sticky site header, with a little air. */
const UNDER_HEADER = 80;
/** The air left under a column too tall for the screen, once its foot is in view. */
const FOOT_ROOM = 24;

/**
 * The couple page's left column, their dates (the visual pop audit's fix-first list: the left column ended ~850px
 * before the right). The right column carries the texts phone and what they've told each other, so on most couples it
 * runs far longer, and no fixed split evens out every pair. So while the right column is the longer one, the dates
 * column is pinned (.couple-main.is-pinned, app/ux/show.css): one that fits on the screen stays under the header, and
 * one taller than the screen scrolls until its foot is in view and holds there. Either way it stays beside what's
 * being read on the right, every line of it is reached, and the two columns end together.
 */
export default function CoupleMain({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    const rail = el?.parentElement?.querySelector<HTMLElement>(".couple-rail");
    if (!el || !rail || typeof ResizeObserver === "undefined") return;
    const wide = window.matchMedia("(min-width: 60rem)");
    const check = () => {
      const h = el.offsetHeight;
      if (!wide.matches || rail.offsetHeight <= h + FOOT_ROOM) return setTop(null);
      setTop(h + UNDER_HEADER + FOOT_ROOM <= window.innerHeight ? UNDER_HEADER : window.innerHeight - h - FOOT_ROOM);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    ro.observe(rail);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <div ref={ref} className={top === null ? "couple-main" : "couple-main is-pinned"} style={top === null ? undefined : ({ "--pin-top": `${top}px` } as CSSProperties)}>
      {children}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

type Props = {
  /** The real figure: what the page says before, after and without the count (and to anyone who prefers no motion). */
  value: number;
  /** Places after the point (2 for dollars and cents). */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
};

const DURATION = 1100;

/** The figure as the page prints it: en-US grouping, a fixed number of places. */
export function countText(n: number, decimals = 0, prefix = "", suffix = ""): string {
  return `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
}

/**
 * A headline figure that counts up once, the first time it's on screen (the motion kit, app/ux/motion.css). The real
 * number is in the HTML and stays there for crawlers, screen readers, reduced motion and a page with no script; the
 * count only rewrites the visible digits, from zero, and ends on the same text. The final figure holds the width
 * (.count-up::before), so the words beside it don't shuffle while it counts.
 */
export default function CountUp({ value, decimals = 0, prefix = "", suffix = "", className }: Props) {
  const face = useRef<HTMLSpanElement>(null);
  const final = countText(value, decimals, prefix, suffix);

  useEffect(() => {
    // React's own text node is rewritten in place (never replaced), so a later render still finds the one it made.
    const el = face.current;
    const text = el?.firstChild;
    if (!el || !text || text.nodeType !== Node.TEXT_NODE || !(value > 0) || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const run = () => {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        const eased = 1 - Math.pow(1 - t, 3);
        text.nodeValue = t < 1 ? countText(value * eased, decimals, prefix, suffix) : final;
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        run();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      text.nodeValue = final;
    };
  }, [value, decimals, prefix, suffix, final]);

  return (
    <span className={className ? `count-up ${className}` : "count-up"} data-final={final}>
      <span ref={face}>{final}</span>
    </span>
  );
}

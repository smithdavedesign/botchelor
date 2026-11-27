import type { CSSProperties } from "react";

/**
 * A short fall of rose petals over the show's big moments (2026-11-27, Dave: "more background and video effects or
 * animations"): Sunday's envelope opening, a ship's top pick being stamped. Pure CSS (app/ux/motion.css .petals), so it
 * renders on the server: about a dozen petals drift down once, turning as they go, and are gone in under four seconds.
 * Nothing waits on it and it covers nothing a click needs (pointer-events: none). Reduced motion never shows it.
 *
 * Positions are a fixed table, not random, so the server's HTML and the browser's agree and a screenshot is the same
 * every run.
 */
const PETALS: readonly { x: number; d: number; s: number; r: number; w: number }[] = [
  { x: 6, d: 0.0, s: 1.0, r: 220, w: 18 },
  { x: 15, d: 0.35, s: 0.8, r: -160, w: -12 },
  { x: 24, d: 0.15, s: 1.15, r: 300, w: 22 },
  { x: 33, d: 0.6, s: 0.9, r: -240, w: -20 },
  { x: 42, d: 0.05, s: 1.05, r: 180, w: 14 },
  { x: 51, d: 0.45, s: 0.75, r: -320, w: -16 },
  { x: 60, d: 0.2, s: 1.2, r: 260, w: 24 },
  { x: 69, d: 0.7, s: 0.85, r: -200, w: -14 },
  { x: 78, d: 0.1, s: 1.0, r: 340, w: 18 },
  { x: 87, d: 0.5, s: 0.9, r: -280, w: -22 },
  { x: 94, d: 0.25, s: 1.1, r: 200, w: 12 },
  { x: 47, d: 0.85, s: 0.7, r: -180, w: 20 },
];

export default function Petals({ delay = 0, className }: { /** Seconds before the first petal falls (to land with a stamp or an unseal). */ delay?: number; className?: string }) {
  return (
    <span className={className ? `petals ${className}` : "petals"} aria-hidden="true">
      {PETALS.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={{ "--x": `${p.x}%`, "--d": `${delay + p.d}s`, "--s": p.s, "--r": `${p.r}deg`, "--w": `${p.w}px` } as CSSProperties}
        />
      ))}
    </span>
  );
}

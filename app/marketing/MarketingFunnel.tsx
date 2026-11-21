"use client";

import { useEffect, useState, type CSSProperties } from "react";
// Only the type: the page works the steps out on the server (lib/marketing-funnel.ts) and passes them down.
import type { FunnelStep } from "@/lib/marketing-funnel";

/** How the bars stand: at full (the page as sent), held at nothing off screen, or drawing in. */
type Draw = "rest" | "armed" | "go";

/**
 * Marketing's funnel, drawing itself (lib/marketing-funnel.ts; the visual pop audit's leftovers): four bars on one
 * scale, from the posts to the dates they led to, each with its figure and what it means printed beside it. The page
 * sends it complete; the bars grow in one after another the first time it's on screen (the motion kit's fill-grow).
 * Off screen it waits with the bars held at nothing, where no one sees them go; under reduced motion, or with no way
 * to tell when it's on screen, it stays as sent.
 */
export default function MarketingFunnel({ steps }: { steps: readonly FunnelStep[] }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [draw, setDraw] = useState<Draw>("rest");
  useEffect(() => {
    if (!root || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e && e.intersectionRatio >= 0.5) {
          io.disconnect();
          setDraw("go");
        } else setDraw("armed");
      },
      { threshold: [0, 0.5] },
    );
    io.observe(root);
    return () => io.disconnect();
  }, [root]);
  return (
    <figure className="marketing-funnel" ref={setRoot} data-draw={draw}>
      <figcaption className="kicker">From a post to a date</figcaption>
      <ol>
        {steps.map((s, n) => (
          <li key={s.key} style={{ "--share": s.share, "--n": n } as CSSProperties}>
            <span className="marketing-funnel-label">{s.label}</span>
            <span className="marketing-funnel-track" aria-hidden="true">
              <span className={s.value > 0 ? "marketing-funnel-bar" : "marketing-funnel-bar is-empty"} />
            </span>
            <span className="marketing-funnel-value">
              <strong>{s.value.toLocaleString("en-US")}</strong>
              {s.note && <span className="muted small"> {s.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

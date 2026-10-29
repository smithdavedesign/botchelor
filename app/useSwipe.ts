"use client";

import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

export type SwipeWay = "left" | "right" | "up";

/**
 * A card that's dragged or flung to decide (the creator suite's rating deck; the same feel as the dating deck in
 * app/swipe/SwipeDeck.tsx, which keeps its own): past `threshold` pixels sideways, or up when `up` is on, it leaves that
 * way and `onDecide` is told; short of it, it springs back. Arrow keys do the same. Reduced motion: no flight, at once.
 */
export function useSwipe(onDecide: (way: SwipeWay) => void | Promise<void>, opts: { threshold?: number; up?: boolean } = {}) {
  const threshold = opts.threshold ?? 110;
  const start = useRef<{ x: number; y: number } | null>(null);
  const busy = useRef(false);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<SwipeWay | null>(null);

  const decide = useCallback(
    async (way: SwipeWay) => {
      if (busy.current) return;
      busy.current = true;
      setLeaving(way);
      const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      await new Promise((r) => setTimeout(r, still ? 0 : 200));
      setLeaving(null);
      setDrag({ x: 0, y: 0 });
      try {
        await onDecide(way);
      } finally {
        busy.current = false;
      }
    },
    [onDecide],
  );

  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (busy.current || e.button !== 0) return;
      e.preventDefault();
      start.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (start.current) setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
    },
    onPointerUp: () => {
      if (!start.current) return;
      start.current = null;
      setDragging(false);
      if (opts.up && -drag.y > threshold && Math.abs(drag.y) > Math.abs(drag.x)) void decide("up");
      else if (Math.abs(drag.x) > threshold) void decide(drag.x > 0 ? "right" : "left");
      else setDrag({ x: 0, y: 0 });
    },
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const way = e.key === "ArrowRight" ? "right" : e.key === "ArrowLeft" ? "left" : e.key === "ArrowUp" && opts.up ? "up" : null;
    if (!way) return;
    e.preventDefault();
    void decide(way);
  };
  const x = leaving === "right" ? 700 : leaving === "left" ? -700 : leaving === "up" ? 0 : drag.x;
  const y = leaving === "up" ? -800 : opts.up ? Math.min(0, drag.y) : 0;
  return {
    handlers: { ...handlers, onPointerCancel: handlers.onPointerUp },
    onKeyDown,
    decide,
    dragging,
    /** The card's transform now, and how far it leans each way (−1…1; up 0…1). */
    style: { transform: `translate(${x}px, ${y}px) rotate(${x / 18}deg)` },
    lean: { x: Math.max(-1, Math.min(1, x / threshold)), up: Math.max(0, Math.min(1, -y / threshold)) },
  };
}

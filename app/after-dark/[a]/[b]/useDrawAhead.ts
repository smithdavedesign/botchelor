"use client";

import { useCallback, useEffect, useState } from "react";
import type { DrawAhead } from "@/lib/adult/draw-ahead";

/**
 * Draw ahead for the pair (lib/adult/draw-ahead.ts): whether it's offered and on, and its price, asked again when the
 * chapter or its moments change (it turns itself off when a chapter can't be paid for); `set` turns it on (the moments
 * still waiting from line `at` start drawing) or off.
 */
export function useDrawAhead(a: string, b: string, key: string, enabled = true) {
  const [view, setView] = useState<DrawAhead | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/admin/after-dark/draw-ahead?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { draw_ahead?: DrawAhead } | null) => {
        if (live && d?.draw_ahead) setView(d.draw_ahead);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [a, b, key, enabled]);
  /** Turns it on or off: what the theater says about it. */
  const set = useCallback(
    async (on: boolean, at: number): Promise<string> => {
      const res = await fetch("/api/admin/after-dark/draw-ahead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a, b, on, at }) }).catch(() => null);
      const d = (await res?.json().catch(() => null)) as { draw_ahead?: DrawAhead; note?: string; message?: string } | null;
      if (d?.draw_ahead) setView(d.draw_ahead);
      return d?.note ?? d?.message ?? "It couldn't be changed just now.";
    },
    [a, b],
  );
  return { view, set };
}

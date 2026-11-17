"use client";

import { useEffect, useState } from "react";

/** The blended demand per tag (GET /api/tags/demand, lib/tag-demand.ts): roleplay setups and themes, character types. */
export type PickerDemand = { roleplays: Record<string, number>; types: Record<string, number> };

// One request a page, whoever asks: several pickers on a page share it.
let pending: Promise<PickerDemand | null> | null = null;

/**
 * Botchelor's own demand per tag, for a picker's order (null until it answers, and if it can't: the census orders the
 * chips meanwhile, so nothing waits on it).
 */
export function useTagDemand(): PickerDemand | null {
  const [demand, setDemand] = useState<PickerDemand | null>(null);
  useEffect(() => {
    let live = true;
    pending ??= fetch("/api/tags/demand")
      .then((r) => (r.ok ? (r.json() as Promise<PickerDemand>) : null))
      .catch(() => null);
    void pending.then((d) => {
      if (live && d) setDemand(d);
    });
    return () => {
      live = false;
    };
  }, []);
  return demand;
}

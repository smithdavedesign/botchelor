"use client";

import { useEffect, useState } from "react";

let pending: Promise<Record<string, number> | null> | null = null;

/**
 * After Dark's own demand per tag (GET /api/admin/after-dark/tag-demand, lib/adult/tag-demand.ts), for Set the scene's
 * and Step in's order. Null until it answers; the census orders the shelves meanwhile.
 */
export function useAdultTagDemand(): Record<string, number> | null {
  const [demand, setDemand] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let live = true;
    pending ??= fetch("/api/admin/after-dark/tag-demand")
      .then((r) => (r.ok ? (r.json() as Promise<{ demand: Record<string, number> }>) : null))
      .then((d) => d?.demand ?? null)
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

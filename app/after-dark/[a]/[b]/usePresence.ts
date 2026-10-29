"use client";

import { useCallback, useEffect, useState } from "react";
import type { Presence } from "@/lib/adult/presence";

/** A presence file (app/api/admin/after-dark/presence/[id]). */
export const presenceUrl = (id: string) => `/api/admin/after-dark/presence/${encodeURIComponent(id)}`;

/** While any part is on its way, asked again this often (a loop takes a few minutes at Venice). */
const POLL_MS = 30_000;

/**
 * The pair's presence for this viewer (lib/adult/presence.ts): each one's expressions and living portrait, asked once
 * and again every POLL_MS while something is being made. `make` asks for whatever's missing of both ("✨ Bring them to
 * life"), and says why when it can't.
 */
export function usePresence(a: string, b: string, enabled = true): { presence: Record<string, Presence>; make: () => Promise<string | null> } {
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/admin/after-dark/presence?ids=${encodeURIComponent(a)},${encodeURIComponent(b)}`)
      .then((r) => (r.ok ? r.json() : { presence: {} }))
      .then((d: { presence?: Record<string, Presence> }) => live && setPresence(d.presence ?? {}))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [a, b, enabled, tick]);
  // The expressions load ahead, so a line's face swaps in at once.
  useEffect(() => {
    for (const p of Object.values(presence)) for (const id of Object.values(p.expressions)) if (id) new Image().src = presenceUrl(id);
  }, [presence]);
  const making = Object.values(presence).some((p) => p.making);
  useEffect(() => {
    if (!enabled || !making) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => window.clearTimeout(t);
  }, [enabled, making, tick]);
  const make = useCallback(async (): Promise<string | null> => {
    const why: string[] = [];
    for (const id of [a, b]) {
      const p = presence[id];
      if (p && (p.making || p.missing === 0)) continue;
      const res = await fetch("/api/admin/after-dark/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ character_id: id }) }).catch(() => null);
      if (!res || !res.ok) why.push(((await res?.json().catch(() => null)) as { message?: string } | null)?.message ?? "It couldn't start just now.");
    }
    setTick((n) => n + 1);
    return why.length ? why.join(" ") : null;
  }, [a, b, presence]);
  return { presence, make };
}

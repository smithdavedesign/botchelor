"use client";

import { useCallback, useEffect, useState } from "react";
import type { Talk } from "@/lib/adult/talks";

/** While one is being made, asked again this often (a clip takes a minute or two). */
const POLL_MS = 20_000;

/** A talking moment's file (app/api/admin/after-dark/talk/[id]). */
export const talkUrl = (id: string) => `/api/admin/after-dark/talk/${encodeURIComponent(id)}`;

/**
 * The pair's talking moments for this viewer (lib/adult/talks.ts), their price, and `ask` for the line on stage: asked
 * once, and again every POLL_MS while one is being made.
 */
export function useTalks(a: string, b: string, enabled = true) {
  const [talks, setTalks] = useState<Talk[]>([]);
  const [price, setPrice] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/admin/after-dark/talk?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { talks?: Talk[]; price?: number } | null) => {
        if (!live || !d) return;
        setTalks(d.talks ?? []);
        setPrice(d.price ?? 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [a, b, enabled, tick]);
  const making = talks.some((t) => t.status === "making");
  useEffect(() => {
    if (!enabled || !making) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => window.clearTimeout(t);
  }, [enabled, making, tick]);
  /** Asks for the line's talking moment: the one made (or being made), or why not. */
  const ask = useCallback(
    async (i: number, text: string, nightId: string | null): Promise<{ talk: Talk } | { message: string }> => {
      const res = await fetch("/api/admin/after-dark/talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a, b, i, text, night_id: nightId }) }).catch(() => null);
      const d = (await res?.json().catch(() => null)) as { talk?: Talk; message?: string } | null;
      setTick((n) => n + 1);
      return res?.ok && d?.talk ? { talk: d.talk } : { message: d?.message ?? "It couldn't start just now." };
    },
    [a, b],
  );
  return { talks, price, ask };
}

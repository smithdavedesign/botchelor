"use client";

import { useEffect, useRef, useState } from "react";
import { isPlaceholder, placeLabel, setPath, type PlaceId } from "@/lib/venues";

/** What the stage shows: a venue, and its drawn set's picture (a loaded object URL), null for none, undefined for the default. */
export type Shown = { venue: PlaceId | null; setUrl: string | null | undefined; steady: boolean };

/** Where a set stands, from /api/sets/<place>'s `x-set-status` header. */
export type SetProbe = "ready" | "drawing" | "retrying" | "refused" | "failed" | "none";

/**
 * What to show while a scene's set is asked for (David, 2026-10-21: "when a scene changes I always get the blurred
 * temporary image"). A set that's ready swaps in once its picture has loaded. While one is drawing (or will be checked
 * again), a stage that already shows a ready set keeps it; only a scene's very first set shows the placeholder (the
 * place's name on the generic set) meanwhile. A set that isn't coming shows the placeholder, without asking for it again.
 */
export function nextShown(prev: Shown, want: PlaceId | null, probe: SetProbe, loaded: string | null = null): Shown {
  if (probe === "ready" && loaded) return { venue: want, setUrl: loaded, steady: true };
  if (probe === "drawing" || probe === "retrying") return prev.steady ? prev : { venue: want, setUrl: null, steady: false };
  return { venue: want, setUrl: null, steady: false };
}

const POLL_MS = { drawing: 8000, retrying: 30000 } as const;
const MAX_POLLS = 40;

/** The stage to show for the set the scene wants, preloaded so a ready set never flashes the placeholder. */
export function useSteadySet(want: PlaceId | null): Shown {
  const label = isPlaceholder(want) ? placeLabel(want) : null;
  // First paint: the set's own address (a ready set loads as it always did; one that's drawing paints nothing).
  const [shown, setShown] = useState<Shown>(() => ({ venue: want, setUrl: undefined, steady: !label }));
  const current = useRef(shown);
  current.current = shown;
  const urls = useRef<string[]>([]);

  useEffect(() => {
    // A library venue (or their date's) is a static picture: no drawing, no waiting.
    if (!label) {
      setShown({ venue: want, setUrl: undefined, steady: true });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const probe = async () => {
      const res = await fetch(setPath(label)).catch(() => null);
      if (cancelled) return;
      const status = (res?.headers.get("x-set-status") as SetProbe | null) ?? (res?.ok ? "ready" : "none");
      let loaded: string | null = null;
      if (status === "ready" && res) {
        const blob = await res.blob().catch(() => null);
        if (cancelled) return;
        if (blob) {
          loaded = URL.createObjectURL(blob);
          urls.current.push(loaded);
        }
      }
      setShown(nextShown(current.current, want, status, loaded));
      if ((status === "drawing" || status === "retrying") && ++polls < MAX_POLLS) timer = setTimeout(probe, POLL_MS[status]);
    };
    void probe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [want, label]);

  // Loaded pictures are let go when the theater closes (all but the one on stage would do, but a night has few sets).
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  return shown;
}

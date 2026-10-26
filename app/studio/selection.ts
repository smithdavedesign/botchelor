"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Where a Studio's creator tools ask (app/studio/TileTools.tsx, ExportDialog.tsx, CaptionsPanel.tsx): After Dark's routes
 * or the PG Studio's. Literal paths, so a page's own file says which it calls (tests/after-dark-host.test.ts reads them).
 */
export type StudioApi = { export: string; captions: string; captionsKey: "media_id" | "picture_id" };
export const AFTER_DARK_API: StudioApi = { export: "/api/admin/after-dark/export", captions: "/api/admin/after-dark/captions", captionsKey: "media_id" };
export const PG_API: StudioApi = { export: "/api/studio/export", captions: "/api/studio/captions", captionsKey: "picture_id" };

/** Picking pictures to export together: on, the picked ids in the order they were picked, and the moves. */
export type Selection = {
  selecting: boolean;
  ids: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  set: (ids: string[]) => void;
  start: () => void;
  done: () => void;
};

export function useSelection(): Selection {
  const [selecting, setSelecting] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const toggle = useCallback((id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id])), []);
  const start = useCallback(() => setSelecting(true), []);
  const done = useCallback(() => {
    setSelecting(false);
    setIds([]);
  }, []);
  return useMemo(() => ({ selecting, ids, has: (id: string) => ids.includes(id), toggle, set: setIds, start, done }), [selecting, ids, toggle, start, done]);
}

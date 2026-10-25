"use client";

import { useEffect, useState } from "react";

export type SceneMedia = {
  /** A picture the pair already has of this exact act (the 📷 chip opens it). */
  match: { image_id: string } | null;
  /** The best fuzzy match of the pair's media (a clip to loop, or a still) to stand behind the scene (sceneBackdrop). */
  backdrop: { kind: "clip" | "image"; id: string } | null;
};

const EMPTY: SceneMedia = { match: null, backdrop: null };

/**
 * Media the pair already has for the live scene now (lib/adult/scene-match.ts): the exact-act picture (the 📷 chip) and
 * the best fuzzy backdrop (a clip or a still of where they are / what's happening), in one fetch, re-checked each time
 * the scene moves on (`shown`). Nothing when there's no match.
 */
export function useSceneMedia(a: string, b: string, shown: number, enabled = true): SceneMedia {
  const [media, setMedia] = useState<SceneMedia>(EMPTY);
  useEffect(() => {
    if (!enabled) {
      setMedia(EMPTY);
      return;
    }
    let live = true;
    fetch(`/api/admin/after-dark/scene-match?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then((r) => r.json())
      .then((d: Partial<SceneMedia>) => live && setMedia({ match: d.match ?? null, backdrop: d.backdrop ?? null }))
      .catch(() => live && setMedia(EMPTY));
    return () => {
      live = false;
    };
  }, [a, b, shown, enabled]);
  return media;
}

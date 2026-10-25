"use client";

import { useEffect, useState } from "react";

export type SceneMedia = {
  /** A picture the pair already has of this moment (the 📷 chip opens it). */
  match: { image_id: string } | null;
  /** A short clip of this moment to loop as a backdrop (lib/adult/scene-match.ts sceneClip). */
  clip: { media_id: string } | null;
};

const EMPTY: SceneMedia = { match: null, clip: null };

/**
 * Media the pair already has of what's happening in the live scene now (lib/adult/scene-match.ts): the matching picture
 * and the matching clip, in one fetch, re-checked each time the scene moves on (`shown`). Nothing when there's no match.
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
      .then((d: Partial<SceneMedia>) => live && setMedia({ match: d.match ?? null, clip: d.clip ?? null }))
      .catch(() => live && setMedia(EMPTY));
    return () => {
      live = false;
    };
  }, [a, b, shown, enabled]);
  return media;
}

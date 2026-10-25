"use client";

import { useEffect, useRef, useState } from "react";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/**
 * A short clip the pair already has of the moment, looped muted and dimmed behind the drawn scene as a living backdrop
 * (lib/adult/scene-match.ts sceneClip; David, 2026-10-24: "if they have a short reel like blowjob it can repeat in the
 * background"). It fades in over the set only once the file has loaded (so the set never flashes to black), and the
 * viewer can turn it off — then the drawn set shows as before. Nothing renders when there's no matching clip.
 */
export default function SceneBackdrop({ mediaId }: { mediaId: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(true);
  const [ready, setReady] = useState(false);
  // A new clip starts hidden until it has loaded enough to play, so the set doesn't flash.
  useEffect(() => setReady(false), [mediaId]);
  if (!mediaId || !on) return null;
  return (
    <>
      <video
        ref={ref}
        className={`ad-scene-backdrop${ready ? " on" : ""}`}
        src={mediaUrl(mediaId)}
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
        aria-hidden
        onCanPlay={() => {
          setReady(true);
          void ref.current?.play().catch(() => {});
        }}
      />
      {ready && (
        <button type="button" className="ad-scene-backdrop-off" onClick={() => setOn(false)} title="Show the drawn scene instead" aria-label="Turn off the clip backdrop">
          ⊗ Clip
        </button>
      )}
    </>
  );
}

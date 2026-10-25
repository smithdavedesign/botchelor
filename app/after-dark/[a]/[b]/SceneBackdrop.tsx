"use client";

import { useEffect, useRef, useState } from "react";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

export type Backdrop = { kind: "clip" | "image"; id: string };

/**
 * Media the pair already has of the moment, standing behind the drawn scene as a living backdrop (lib/adult/scene-match.ts
 * sceneBackdrop; David, 2026-10-24/25: "if they have a short reel like blowjob it can repeat in the background … if we
 * have a fuzzy match for the scene put it as the background"). A clip loops muted (most immersive); a still just sits
 * there. It fades in only once the file has loaded (so the set never flashes), and the viewer can turn it off — then the
 * drawn set shows as before. Nothing renders when there's no match. A new match turns it back on.
 */
export default function SceneBackdrop({ backdrop }: { backdrop: Backdrop | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(true);
  const [ready, setReady] = useState(false);
  const id = backdrop?.id ?? null;
  // A new backdrop starts hidden until it has loaded (so the set doesn't flash), and re-enabled if it was turned off.
  useEffect(() => {
    setReady(false);
    setOn(true);
  }, [id]);
  if (!backdrop || !on) return null;
  return (
    <>
      {backdrop.kind === "clip" ? (
        <video
          ref={ref}
          className={`ad-scene-backdrop${ready ? " on" : ""}`}
          src={mediaUrl(backdrop.id)}
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
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- private, presigned media, decorative backdrop
        <img className={`ad-scene-backdrop${ready ? " on" : ""}`} src={mediaUrl(backdrop.id)} alt="" aria-hidden onLoad={() => setReady(true)} />
      )}
      {ready && (
        <button type="button" className="ad-scene-backdrop-off" onClick={() => setOn(false)} title="Show the drawn scene instead" aria-label="Turn off the scene backdrop">
          ⊗ {backdrop.kind === "clip" ? "Clip" : "Photo"}
        </button>
      )}
    </>
  );
}

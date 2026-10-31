"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** How long before the loop's end it fades back into the face (the loop starts from the face, so the restart can't show). */
const FADE_S = 0.45;

/**
 * A character's face on the theater's stage (lib/adult/presence.ts; docs/PRDs/theater-immersion.md #1 and #2): the
 * expression of the line they're saying when there's one, else their living portrait playing over their face, else the
 * face itself (`fallback`, the stage's Avatar). Muted and inline; with reduced motion or on a phone, the still face only.
 */
export default function LivingFace({ face, expression, loop, name, size, fallback }: { face: string | null; expression: string | null; loop: string | null; name: string; size: number; fallback: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const [fading, setFading] = useState(false);
  // Still until it's known it can move: the server's markup has no video, so a phone never starts loading one.
  const [still, setStill] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    // Still with reduced motion, and on a phone, where the stage's cast is hidden (globals.css) and the loop would load for nothing.
    const q = window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 760px)");
    setStill(q.matches);
    const on = () => setStill(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  // Near its end it fades out onto the face, restarts from its first frame (the face), and fades back in.
  const onTime = () => {
    const v = video.current;
    if (!v || !v.duration || fading) return;
    if (v.duration - v.currentTime <= FADE_S) {
      setFading(true);
      window.setTimeout(() => {
        if (!video.current) return;
        video.current.currentTime = 0;
        void video.current.play().catch(() => {});
        setFading(false);
      }, FADE_S * 1000);
    }
  };
  // #1130: a picture that won't load (a 404, an expired link) gives way to the next one, and at last to the Avatar.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const shown = [expression, face].find((u): u is string => Boolean(u) && !broken.has(u!)) ?? null;
  if (!shown) return <>{fallback}</>;
  const playing = Boolean(loop && !expression && !still);
  return (
    // The Avatar's shape (app/Avatar.tsx), so a face coming to life doesn't change shape.
    <span className="ad-living-face" style={{ width: size, height: size, borderRadius: size * 0.28 }} aria-label={name} role="img">
      {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media */}
      <img src={shown} alt="" className="ad-living-still" draggable={false} onError={() => setBroken((b) => new Set([...b, shown]))} />
      {playing && (
        <video
          ref={video}
          className={`ad-living-loop${fading ? " fading" : ""}`}
          src={loop!}
          poster={face && !broken.has(face) ? face : undefined}
          muted
          playsInline
          autoPlay
          preload="auto"
          onTimeUpdate={onTime}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

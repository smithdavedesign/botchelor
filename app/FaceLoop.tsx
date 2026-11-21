"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useInViewAutoplay } from "@/app/useInViewAutoplay";
import { faceLoopOf } from "@/lib/face-loops";
import styles from "./FaceLoop.module.css";

/**
 * A cast member's face, moving (lib/face-loops.ts): their portrait (`children`) at rest, and over it a short silent loop
 * that plays while it's on screen by the show's autoplay rules (app/useInViewAutoplay.ts: muted, paused off screen,
 * never with reduced motion). Never on Save-Data. The portrait stays the picture: the loop fades in only once it plays,
 * and a character without a loop is their portrait alone. `radius`: the portrait's corner, for a fixed-size avatar;
 * `fill`: the portrait fills its card (the /characters cards).
 */
export default function FaceLoop({ id, children, radius, fill = false }: { id: string; children: ReactNode; radius?: number; fill?: boolean }) {
  const src = faceLoopOf(id);
  const [root, setRoot] = useState<HTMLSpanElement | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const saving = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (!saving) setAllowed(true);
  }, []);
  useInViewAutoplay(root, allowed);
  if (!src) return <>{children}</>;
  return (
    <span ref={setRoot} className={[styles.loop, fill && styles.fill, playing && styles.playing].filter(Boolean).join(" ")} >
      {children}
      {allowed && (
        <video data-autoplay="" src={src} muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} style={radius ? { borderRadius: radius } : undefined} onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      )}
    </span>
  );
}

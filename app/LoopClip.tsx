"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/app/Icon";
import type { Promo } from "@/app/PromoVideo";

/**
 * One of the show's own videos as a quiet loop at the top of a page (the visual pop audit, 2026-11-20: /agents's MCP cut
 * had waited at 0:00 halfway down). The home clip's rules (app/HomeClip.tsx): the poster is the first paint and nothing
 * loads until it plays; once the page is live it plays by itself, muted and looping, unless the visitor asked for less
 * motion or to save data, or the browser won't autoplay, and then the poster stays with a play button. Never sound.
 */
export default function LoopClip({ video, caption }: { video: Promo; caption?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  // "wait": before the page is live (no button yet, so it doesn't flash); "still": the poster and a play button.
  const [state, setState] = useState<"wait" | "still" | "playing">("wait");

  const play = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.play().then(
      () => setState("playing"),
      () => setState("still"),
    );
  };

  useEffect(() => {
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const saving = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (calm || saving) setState("still");
    else play();
  }, []);

  return (
    <figure className="loop-clip">
      <div className="loop-clip-screen" style={{ aspectRatio: `${video.width} / ${video.height}` }}>
        <video ref={ref} className="loop-clip-video" muted loop playsInline preload="none" poster={video.poster} width={video.width} height={video.height} aria-label={video.label}>
          <source src={video.src} type="video/mp4" />
        </video>
        {state === "still" && (
          <button type="button" className="loop-clip-play" onClick={play} aria-label="Play the clip">
            <Icon name="play" />
          </button>
        )}
      </div>
      {caption && <figcaption className="loop-clip-cap">{caption}</figcaption>}
    </figure>
  );
}

"use client";

import { useRef, useState } from "react";

/**
 * A diary-cam line on film (lib/date-film.ts): the character's confessional still, which says the line when it's
 * pressed. Nothing loads until then (the still is the poster), and it never plays by itself: it has a voice.
 */
export default function ConfessionalClip({ src, poster, name, seconds }: { src: string; poster: string | null; name: string; seconds: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const first = name.trim().split(/\s+/)[0] || name;
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  return (
    <button
      type="button"
      className="confessional-clip"
      onClick={toggle}
      aria-pressed={playing}
      aria-label={playing ? `Pause ${first}'s diary cam` : `Play ${first}'s diary cam: ${Math.max(1, Math.round(seconds))} seconds, with sound`}
      data-confessional-clip
      data-track="confessional-clip"
    >
      <video ref={video} src={src} poster={poster ?? undefined} preload="none" playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <span className="confessional-clip-play" aria-hidden="true">
        {playing ? "❚❚" : "▶"}
      </span>
    </button>
  );
}

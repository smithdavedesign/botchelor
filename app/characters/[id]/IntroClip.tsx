"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/app/Icon";

/**
 * A character's hello (lib/cast-intros.ts) as the face of their contestant card (the visual pop audit, 2026-11-20: it
 * had sat under "Right now", below the header). By the home clip's rules (app/HomeClip.tsx): the portrait is the poster
 * and the first paint, nothing loads until it plays, and once the page is live it plays by itself, muted and looping,
 * unless the visitor asked for less motion or to save data (then the portrait stays, with a play button). Sound only
 * on a tap: the hello is in their own voice, so a Listen switch beside the pause.
 */
export default function IntroClip({ src, poster, name }: { src: string; poster: string | undefined; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  // "wait": before the page is live (no buttons yet, so nothing flashes); "still": the poster and a play button.
  const [state, setState] = useState<"wait" | "still" | "playing" | "paused">("wait");
  const [sound, setSound] = useState(false);

  const play = (muted = true) => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
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

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) play(!sound);
    else {
      v.pause();
      setState("paused");
    }
  };
  const listen = () => {
    const v = ref.current;
    if (!v) return;
    const on = !sound;
    setSound(on);
    v.muted = !on;
    if (on && v.paused) play(false);
  };

  return (
    <div className="intro-clip">
      <video ref={ref} muted loop playsInline preload="none" poster={poster} aria-label={`${name} says hello`}>
        <source src={src} />
      </video>
      {state === "still" ? (
        <button type="button" className="intro-clip-play" onClick={() => play(!sound)} aria-label={`Play ${name}'s hello`} data-track="intro-play">
          <Icon name="play" />
        </button>
      ) : state !== "wait" ? (
        <span className="intro-clip-controls">
          <button type="button" onClick={toggle} aria-label={state === "playing" ? "Pause" : "Play"} data-track="intro-pause">
            <Icon name={state === "playing" ? "pause" : "play"} />
          </button>
          <button type="button" onClick={listen} aria-pressed={sound} aria-label={sound ? "Sound off" : `Hear ${name}`} data-track="intro-listen">
            <Icon name="volume" />
          </button>
        </span>
      ) : null}
    </div>
  );
}

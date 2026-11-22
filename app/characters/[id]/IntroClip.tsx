"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/app/Icon";

/** The links the browser measures as slow (Network Information API): a hello of 3 MB or more would take a minute. */
const SLOW_LINKS = new Set(["slow-2g", "2g", "3g"]);

/** How the hello starts: still (the portrait and a play button) for less motion, saving data or a slow link; else by itself. */
export function introStart(calm: boolean, link: { saveData?: boolean; effectiveType?: string } | undefined): "still" | "auto" {
  return calm || link?.saveData === true || SLOW_LINKS.has(link?.effectiveType ?? "") ? "still" : "auto";
}

/**
 * A character's hello (lib/cast-intros.ts) as the face of their contestant card (the visual pop audit, 2026-11-20: it
 * had sat under "Right now", below the header). By the home clip's rules (app/HomeClip.tsx): the portrait is the poster
 * and the first paint, nothing loads until it plays, and once the page is live it plays by itself, muted and looping,
 * unless the visitor asked for less motion or to save data, or is on a slow link (then the portrait stays, with a play
 * button). It waits for the page itself to finish loading and for the card to be on screen, so its megabytes don't race
 * the page's pictures and scripts (2026-11-22 audit: a character page weighed 4.3 MB, 3.5 of them this clip). Sound only
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
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const link = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (introStart(calm, link) === "still") {
      setState("still");
      return;
    }
    const el = ref.current;
    let seen: IntersectionObserver | null = null;
    const start = () => {
      if (!el || typeof IntersectionObserver === "undefined") return play();
      seen = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        seen?.disconnect();
        play();
      });
      seen.observe(el);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      window.removeEventListener("load", start);
      seen?.disconnect();
    };
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

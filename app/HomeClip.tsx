"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/app/Icon";
import PhoneFrame from "@/app/PhoneFrame";

export type HomeClipProps = {
  loopSrc: string;
  posterSrc: string;
  width: number;
  height: number;
  /** The date's replay (its page with ?play=1). */
  watchHref: string;
  /** "A × B · It ended: A second date" (lib/home-clip.ts clipCaption). */
  caption: string;
  /** The line over the caption, and the watch button's words: the show's ad (lib/promo-videos.ts) says its own. */
  kicker?: string;
  watchLabel?: string;
  /** The data-track prefix of its two buttons: "home-clip" on home, the page's own elsewhere (app/ShowClip.tsx). */
  track?: string;
};

/**
 * The day's clip in the home hero (lib/home-clip.ts): a few seconds of a real date playing in the theater, in a phone.
 * The poster is the first paint (the video loads nothing until it plays); once the page is live it plays by itself,
 * muted and looping, unless the visitor asked for less motion or to save data, or the browser won't autoplay: then the
 * poster stays with a play button. Sound never: the clip's voiced cut is for the social sites, and the whole date is
 * one tap away.
 */
export default function HomeClip({ loopSrc, posterSrc, width, height, watchHref, caption, kicker = "A real date from the show", watchLabel = "Watch the whole date", track = "home-clip" }: HomeClipProps) {
  const video = useRef<HTMLVideoElement>(null);
  // "wait": before the page is live (no button yet, so it doesn't flash); "still": the poster and a play button.
  const [state, setState] = useState<"wait" | "still" | "playing">("wait");

  const play = () => {
    const v = video.current;
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
    <figure className="home-clip">
      <PhoneFrame short>
        <div className="home-clip-screen" style={{ aspectRatio: `${width} / ${height}` }}>
          <video ref={video} className="home-clip-video" muted loop playsInline preload="none" poster={posterSrc} width={width} height={height} aria-label={`A clip of the date: ${caption}`}>
            <source src={loopSrc} type="video/mp4" />
          </video>
          {state === "still" && (
            <button type="button" className="home-clip-play" onClick={play} aria-label="Play the clip" data-track={`${track}-play`}>
              <Icon name="play" />
            </button>
          )}
        </div>
      </PhoneFrame>
      <figcaption className="home-clip-cap">
        <span className="home-clip-kicker">{kicker}</span>
        <span className="home-clip-who">{caption}</span>
        <Link className="button-ghost home-clip-watch" href={watchHref} data-track={`${track}-watch`}>
          <Icon name="play" /> {watchLabel}
        </Link>
      </figcaption>
    </figure>
  );
}

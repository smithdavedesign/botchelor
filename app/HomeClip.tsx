"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/app/Icon";
import { useT } from "@/app/I18nProvider";
import PhoneFrame from "@/app/PhoneFrame";
import { flush, queueEvent } from "@/app/engagement";
import { clipCounter, clipWhere, PHONE_MEDIA, type ClipCounter } from "@/lib/clip-count";

export type HomeClipProps = {
  loopSrc: string;
  posterSrc: string;
  width: number;
  height: number;
  /** The date's replay (its page with ?play=1). */
  watchHref: string;
  /** "A × B · How it ended: a second date" (lib/home-clip.ts clipCaption). */
  caption: string;
  /** The line over the caption, and the watch button's words: the show's ad (lib/promo-videos.ts) says its own. */
  kicker?: string;
  watchLabel?: string;
  /** The data-track prefix of its two buttons: "home-clip" on home, the page's own elsewhere (app/ShowClip.tsx). */
  track?: string;
  /**
   * On home's first screen (app/HomeOpen.tsx): its plays count as the short version's do (lib/clip-count.ts). `stage`:
   * on a phone it stands on the stage, in the first screen (HOME_PHONE_CLIP), and a tap on it while it plays opens the
   * date, as its watch button does.
   */
  home?: { stage: boolean };
};

/**
 * The day's clip in the home hero (lib/home-clip.ts): a few seconds of a real date playing in the theater, in a phone.
 * The poster is the first paint (the video loads nothing until it plays); once the page is live it plays by itself while
 * it is on screen, muted and looping, and rests when scrolled away, unless the visitor asked for less motion or to save
 * data, or the browser won't autoplay: then the poster stays with a play button. Sound never: the clip's voiced cut is
 * for the social sites, and the whole date is one tap away.
 */
export default function HomeClip({ loopSrc, posterSrc, width, height, watchHref, caption, kicker, watchLabel, track = "home-clip", home }: HomeClipProps) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  // "wait": before the page is live (no button yet, so it doesn't flash); "still": the poster and a play button.
  const [state, setState] = useState<"wait" | "still" | "playing">("wait");
  // Whether it plays while on screen: from the start, unless the visitor asked for less motion or to save data (then
  // from a tap on play). `auto`: no tap yet, so a start is the clip's own.
  const wanted = useRef(false);
  const auto = useRef(true);
  const counter = useRef<ClipCounter | null>(null);

  const play = () => {
    const v = video.current;
    if (!v) return;
    v.muted = true;
    v.play().then(
      () => {
        setState("playing");
        counter.current?.play(auto.current, v.duration);
      },
      () => {
        wanted.current = false;
        setState("still");
      },
    );
  };
  const tapPlay = () => {
    wanted.current = true;
    auto.current = false;
    play();
  };
  const leaving = () => counter.current?.leave("tap", video.current?.currentTime ?? 0);
  const counting = home !== undefined;
  const stage = home?.stage === true;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const count = counting ? clipCounter(clipWhere(window.matchMedia?.(PHONE_MEDIA).matches ?? false, stage), (e) => queueEvent(e.name, e.props)) : null;
    counter.current = count;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const saving = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    wanted.current = !(calm || saving);
    if (!wanted.current) setState("still");
    // Only on screen: nothing loads while it's out of sight, and it rests once scrolled away.
    let seen: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      seen = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            if (wanted.current && v.paused) play();
          } else if (!v.paused) v.pause();
        },
        { threshold: 0.25 },
      );
      seen.observe(v);
    } else if (wanted.current) play();
    const onTime = () => count?.at(v.currentTime);
    const onHide = () => {
      if (document.visibilityState === "hidden" && count?.leave("hidden", v.currentTime)) flush();
    };
    v.addEventListener("timeupdate", onTime);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      seen?.disconnect();
      v.removeEventListener("timeupdate", onTime);
      document.removeEventListener("visibilitychange", onHide);
      count?.leave("away", v.currentTime);
    };
  }, [counting, stage]);

  return (
    <figure className="home-clip">
      <PhoneFrame short>
        <div className="home-clip-screen" style={{ aspectRatio: `${width} / ${height}` }}>
          <video ref={video} className="home-clip-video" muted loop playsInline preload="none" poster={posterSrc} width={width} height={height} aria-label={t("A clip of the date: {caption}", { caption })}>
            <source src={loopSrc} type="video/mp4" />
          </video>
          {/* On the stage, the playing clip is itself the way in (app/ux/front.css shows it on a phone only). The caption's
              button is the way for a keyboard or a screen reader, so this one is for a finger alone. */}
          {stage && state === "playing" && (
            <Link className="home-clip-tap" href={watchHref} prefetch={false} tabIndex={-1} aria-hidden="true" data-track={`${track}-watch`} data-track-where="home_phone" onClick={leaving}>
              <span className="home-clip-tap-cue">
                <Icon name="play" /> {t("Watch")}
              </span>
            </Link>
          )}
          {state === "still" && (
            <button type="button" className="home-clip-play" onClick={tapPlay} aria-label={t("Play the clip")} data-track={`${track}-play`}>
              <Icon name="play" />
            </button>
          )}
        </div>
      </PhoneFrame>
      <figcaption className="home-clip-cap">
        <span className="home-clip-kicker">{kicker ?? t("A real date from the show")}</span>
        <span className="home-clip-who">{caption}</span>
        <Link className="button-ghost home-clip-watch" href={watchHref} data-track={`${track}-watch`} onClick={counting ? leaving : undefined}>
          <Icon name="play" /> {watchLabel ?? t("Watch the whole date")}
        </Link>
      </figcaption>
    </figure>
  );
}

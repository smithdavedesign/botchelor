"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/app/Icon";
import Tilt from "@/app/motion/Tilt";
import type { FeatureReel } from "@/lib/showcase-feature";

/**
 * The gallery's "Now showing" (the visual pop audit's pass 3: Showcase as a cinema): the most liked clip this week, or
 * the newest when nothing is liked yet, large on a dark screen above the grid. Video by the HomeClip rules: the still is
 * the first paint and the clip loads nothing until it plays; it plays by itself, muted and looping, while on screen,
 * unless the visitor asked for less motion or to save data, or the browser won't autoplay: then the still stays with a
 * play button. Never sound here; the full-screen reels have it.
 */
export default function ShowcaseFeature({ reel }: { reel: FeatureReel }) {
  const video = useRef<HTMLVideoElement>(null);
  // "wait": before the page is live (no button yet, so it doesn't flash); "still": the still and a play button.
  const [state, setState] = useState<"wait" | "still" | "playing">("wait");
  const [w, h] = reel.aspect.split(":").map(Number);

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
    const v = video.current;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const saving = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (!v || calm || saving || typeof IntersectionObserver === "undefined") {
      setState("still");
      return;
    }
    // Plays while mostly on screen, rests when scrolled away.
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) play();
        else if (!v.paused) v.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  return (
    <section className="showcase-feature" aria-labelledby="showcase-feature-title">
      <div className="showcase-feature-screen" style={{ aspectRatio: w > 0 && h > 0 ? `${w} / ${h}` : "3 / 4" }}>
        <video
          ref={video}
          muted
          loop
          playsInline
          preload={reel.poster ? "none" : "metadata"}
          poster={reel.poster ?? undefined}
          aria-label={`A clip: ${reel.names}`}
          // With no still of its own, its first frame (a media fragment: browsers draw that frame on load).
          src={reel.poster ? reel.src : `${reel.src}#t=0.1`}
        />
        {state === "still" && (
          <button type="button" className="showcase-feature-play" onClick={play} aria-label="Play the clip" data-track="showcase-feature-play">
            <Icon name="play" />
          </button>
        )}
      </div>
      <div className="showcase-feature-words">
        <p className="showcase-feature-kicker">Now showing</p>
        <h2 id="showcase-feature-title">{reel.names}</h2>
        <p className="showcase-feature-meta">
          {reel.likes > 0 && (
            <>
              <span aria-hidden="true">♥</span> {reel.likes} {reel.likes === 1 ? "like" : "likes"}
              {reel.by ? " · " : ""}
            </>
          )}
          {reel.by && (
            <>
              by <Link href={reel.by.href}>@{reel.by.handle}</Link>
            </>
          )}
        </p>
        <p className="showcase-feature-calls">
          <Link className="button" href={reel.reelsHref} data-track="showcase-feature-watch">
            <Icon name="play" /> Watch full screen
          </Link>
          <Link className="showcase-feature-second" href={reel.character.href} data-track="showcase-feature-character">
            Meet {reel.character.name.split(/\s+/)[0]}
          </Link>
        </p>
        {reel.also.length > 0 && (
          <div className="showcase-feature-also">
            <p className="showcase-feature-also-head">Also showing</p>
            <ul>
              {reel.also.map((a) => (
                <Tilt as="li" key={a.id} max={6}>
                  <Link href={a.href} data-track="showcase-feature-also" aria-label={`Watch: ${a.names}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by the showcase's own gate, not next/image */}
                    <img src={a.poster} alt={`${a.names}: a still from their reel`} loading="lazy" decoding="async" />
                    <span>{a.names}</span>
                  </Link>
                </Tilt>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

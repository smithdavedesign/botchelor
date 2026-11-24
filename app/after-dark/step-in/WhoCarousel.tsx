"use client";

import { useRef, useState, type ReactNode } from "react";
import type { WhoSlide } from "@/lib/adult/step-in-shared";

/**
 * A few pictures of the person picked, to flip through (lib/adult/step-in-who.ts says which): one at a time in the Who
 * step's picture frame, swiped on a phone (the row scrolls and snaps) and stepped with ‹ › elsewhere, with where you
 * are ("2 / 6"). A locked one is the locked preview's blurred tile under a 🔒, and the way to the subscription.
 * `first`: what shows before the pictures come (the portrait as the page already had it).
 */
export default function WhoCarousel({ slides, first, name, lockedHref }: { slides: readonly WhoSlide[]; first: ReactNode; name: string; lockedHref: string | null }) {
  const track = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState(0);
  const n = slides.length;
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const to = Math.max(0, Math.min(n - 1, i));
    el.scrollTo({ left: to * el.clientWidth, behavior: "smooth" });
    setAt(to);
  };
  if (n <= 1) return <>{first}</>;
  return (
    <div className="ad-si-carousel" role="group" aria-roledescription="carousel" aria-label={`Pictures of ${name}`} data-step-in-carousel>
      <ul
        ref={track}
        className="ad-si-carousel-track"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientWidth) setAt(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {slides.map((s, i) => (
          <li key={s.key} aria-roledescription="slide" aria-label={`${i + 1} of ${n}`} data-step-in-slide={s.kind}>
            {i === 0 && s.kind === "portrait" ? (
              first
            ) : s.kind === "locked" ? (
              <a className="ad-si-locked" href={lockedHref ?? undefined} data-step-in-locked>
                {/* eslint-disable-next-line @next/next/no-img-element -- the locked preview's blurred tile */}
                <img src={s.src} alt="" loading="lazy" decoding="async" />
                <span className="ad-si-lock">
                  <span aria-hidden="true">🔒</span> With the subscription
                </span>
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- their own files, sized by their routes
              <img src={s.src} alt={s.alt} loading="lazy" decoding="async" />
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="ad-si-carousel-go ad-si-carousel-prev" aria-label="Previous picture" onClick={() => go(at - 1)} disabled={at === 0}>
        ‹
      </button>
      <button type="button" className="ad-si-carousel-go ad-si-carousel-next" aria-label="Next picture" onClick={() => go(at + 1)} disabled={at >= n - 1}>
        ›
      </button>
      <span className="ad-si-carousel-at" aria-live="polite">
        {at + 1} / {n}
      </span>
    </div>
  );
}

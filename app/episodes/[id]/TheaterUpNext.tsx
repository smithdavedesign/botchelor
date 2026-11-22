"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "@/app/Avatar";
import { queueEvent } from "@/app/engagement";
import type { CharacterRef } from "@/lib/game";

/** The episode the theater's ending offers next (the first of the page's "Up next", lib/up-next.ts). */
export type TheaterNext = { href: string; characters: [CharacterRef, CharacterRef] };

/**
 * How long the ending has the screen to itself before "Up next" joins it. Longer than the daily clip records past the
 * ending (scripts/clips/daily-clip.mjs: three seconds), so the show's clips still end on the ending alone.
 */
export const UP_NEXT_AFTER_MS = 4_000;
/** Then the next episode opens on its own after this many seconds, unless the viewer cancels or does anything else. */
export const AUTOPLAY_SECONDS = 10;

/**
 * "Up next" on the theater's ending (2026-11-22 audit: the end of a date led nowhere). A clear "Next episode" button,
 * and a countdown that opens it in the theater: shown on screen with Cancel beside it, paused while the tab is hidden,
 * and stopped for good by any tap, key or scroll in the theater (sharing, Watch again, reading back), so it only ever
 * carries on a viewer who's sitting back. The next page opens on its cold open, so it never plays on unattended.
 */
export default function TheaterUpNext({ next }: { next: TheaterNext }) {
  const router = useRouter();
  const [shown, setShown] = useState(false);
  const [left, setLeft] = useState(AUTOPLAY_SECONDS);
  const [stopped, setStopped] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [a, b] = next.characters;

  // Any tap, key or scroll in the theater stops the countdown (the button stays).
  useEffect(() => {
    const theater = box.current?.closest(".theater");
    if (!theater) return;
    const stop = (event: Event) => {
      // The Next episode button itself goes on anyway.
      if (event.target instanceof Element && event.target.closest("[data-up-next-go]")) return;
      setStopped(true);
    };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    for (const name of events) theater.addEventListener(name, stop, { passive: true });
    return () => {
      for (const name of events) theater.removeEventListener(name, stop);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShown(true), UP_NEXT_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  const counting = shown && !stopped;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setLeft((n) => Math.max(0, n - 1));
    }, 1_000);
    return () => clearInterval(t);
  }, [counting]);

  const went = useRef(false);
  useEffect(() => {
    if (!counting || left > 0 || went.current) return;
    went.current = true;
    queueEvent("up_next_autoplay", { where: "theater" });
    router.push(next.href);
  }, [counting, left, next.href, router]);

  // Before it shows, an empty element: it only listens.
  if (!shown) return <div ref={box} />;
  return (
    <div className="theater-next" ref={box}>
      <span className="pair-faces" aria-hidden="true">
        <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={36} decorative />
        <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={36} decorative />
      </span>
      <p className="theater-next-what">
        <span className="theater-next-kicker">Up next</span>{" "}
        <strong>
          <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
        </strong>
      </p>
      <p className="theater-next-actions">
        <Link className="button" href={next.href} prefetch={false} data-up-next-go data-track="up-next" data-track-where="theater">
          ▶ Next episode
        </Link>
        {counting && (
          <span className="muted small">
            <span aria-hidden="true">Plays in {left} s</span>
            <span className="sr-only">The next episode plays in {AUTOPLAY_SECONDS} seconds unless you cancel.</span>{" "}
            <button type="button" className="linklike" onClick={() => setStopped(true)}>
              Cancel
            </button>
          </span>
        )}
      </p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "@/app/request";
import { useSwipe, type SwipeWay } from "@/app/useSwipe";
import type { Media } from "@/lib/adult/media";
import { PICTURE_TAGS } from "@/lib/adult/rating-tags";

/**
 * Rate your pictures (the creator suite; David's "delight, no pressure"): their unrated pictures one at a time, full
 * screen. → 👍, ← 👎 (then what was off, or skip), ↑ ⭐ a favorite (and a 👍); the arrow keys too. Every rating steers
 * their next pictures of them (lib/adult/steering.ts), and the deck says so as it goes. No counts to beat, no timer: it
 * ends when the pile does, or when they close it.
 */
export default function RateDeck({ items, src, onClose }: { items: Media[]; src: (id: string) => string; onClose: (changed: boolean) => void }) {
  const [left, setLeft] = useState(items);
  const [said, setSaid] = useState({ up: 0, down: 0, stars: 0 });
  const [why, setWhy] = useState<Media | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deck = useRef<HTMLDivElement>(null);
  const top = left[0];

  useEffect(() => {
    deck.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(said.up + said.down + said.stars > 0);
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("ad-studio-locked");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("ad-studio-locked");
    };
  }, [onClose, said]);

  const rate = (id: string, rating: 1 | -1, tags: string[] = []) => requestJson("/api/admin/after-dark/rate", { media_id: id, rating, tags }).catch(() => null);

  const onDecide = useCallback(
    async (way: SwipeWay) => {
      const m = left[0];
      if (!m) return;
      setError(null);
      setLeft((x) => x.slice(1));
      const res = await rate(m.id, way === "left" ? -1 : 1);
      if (!res?.ok) {
        setError("That rating didn't save; it's back at the end of the pile.");
        setLeft((x) => [...x, m]);
        return;
      }
      if (way === "up") await requestJson("/api/admin/after-dark/favorites", { media_id: m.id, on: true }).catch(() => null);
      setSaid((s) => ({ up: s.up + (way === "right" ? 1 : 0), down: s.down + (way === "left" ? 1 : 0), stars: s.stars + (way === "up" ? 1 : 0) }));
      if (way === "left") setWhy(m);
    },
    [left],
  );
  const swipe = useSwipe(onDecide, { up: true });

  return (
    <div className="ad-rate-deck" role="dialog" aria-modal="true" aria-label="Rate your pictures">
      <header className="ad-rate-deck-head">
        <strong>Rate your pictures</strong>
        <span className="muted small">{left.length ? `${left.length} to go` : "All rated"}</span>
        <button type="button" className="button-ghost small" onClick={() => onClose(said.up + said.down + said.stars > 0)}>
          Done
        </button>
      </header>
      {why ? (
        <div className="ad-rate-why" role="group" aria-label="What was off">
          <p>What was off? It steers away from it next time.</p>
          <div className="ad-rate-tags">
            {Object.entries(PICTURE_TAGS).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className="chip"
                onClick={() => {
                  void rate(why.id, -1, [k]);
                  setWhy(null);
                }}
              >
                {label}
              </button>
            ))}
            <button type="button" className="button-ghost small" onClick={() => setWhy(null)}>
              Skip
            </button>
          </div>
        </div>
      ) : top ? (
        <div className="ad-rate-deck-stage" ref={deck} tabIndex={0} onKeyDown={swipe.onKeyDown} aria-label="Right arrow: more like this. Left: not right. Up: a favorite.">
          <figure key={top.id} className={`ad-rate-card${swipe.dragging ? " is-dragging" : ""}`} style={swipe.style} {...swipe.handlers}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media */}
            <img src={src(top.id)} alt="One of their pictures" draggable={false} />
            <span className="ad-rate-stamp like" style={{ opacity: Math.max(0, swipe.lean.x) }} aria-hidden="true">👍</span>
            <span className="ad-rate-stamp nope" style={{ opacity: Math.max(0, -swipe.lean.x) }} aria-hidden="true">👎</span>
            <span className="ad-rate-stamp star" style={{ opacity: swipe.lean.up }} aria-hidden="true">⭐</span>
          </figure>
        </div>
      ) : (
        <p className="ad-rate-deck-done">That&apos;s every one. Your next pictures of them lean on what you said.</p>
      )}
      {top && !why && (
        <p className="ad-rate-deck-buttons">
          <button type="button" className="secondary" onClick={() => void swipe.decide("left")} aria-label="Not right">👎</button>
          <button type="button" className="secondary" onClick={() => void swipe.decide("up")} aria-label="A favorite">⭐</button>
          <button type="button" className="primary" onClick={() => void swipe.decide("right")} aria-label="More like this">👍</button>
        </p>
      )}
      <p className="muted small ad-rate-deck-steer" role="status">
        {said.up + said.down + said.stars
          ? `${said.up + said.stars} 👍 and ${said.down} 👎 so far${said.stars ? `, ${said.stars} ⭐` : ""}: each one steers their next pictures (the face, the light, what to avoid).`
          : "Swipe right for more like it, left for not right, up for a favorite. Each one steers their next pictures."}
      </p>
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  );
}

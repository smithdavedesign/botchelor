"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { shortName } from "@/lib/names";
import { Card, type DeckCard } from "./SwipeDeck";

/** How far a card has to be dragged to count as a swipe (the real deck's, app/swipe/SwipeDeck.tsx). */
const THRESHOLD = 110;

/**
 * The deck for a visitor without a character (2026-11-14 design audit): a real deck card, one of this season's house
 * cast, that drags, takes the arrow keys and has Pass and Like, like the real one. A swipe here writes nothing: no
 * request goes anywhere (tests/swipe-page.test.ts holds this file to no fetch). The card plays its usual exit, then the
 * deck says what a real swipe would have done and offers Make a character.
 */
export default function DemoDeck({ cards, makeHref }: { cards: DeckCard[]; makeHref: string }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const [done, setDone] = useState<{ card: DeckCard; liked: boolean } | null>(null);
  const startX = useRef<number | null>(null);
  const busy = useRef(false);
  const top = cards[0] ?? null;
  const next = cards[1] ?? null;
  if (!top) return null;
  const name = shortName(top.name);

  const decide = async (like: boolean) => {
    if (busy.current || done) return;
    busy.current = true;
    setLeaving(like ? "right" : "left");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    await new Promise((r) => setTimeout(r, still ? 0 : 220));
    setLeaving(null);
    setDragX(0);
    setDone({ card: top, liked: like });
    busy.current = false;
  };
  const again = () => setDone(null);

  const onDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (busy.current || e.button !== 0) return;
    e.preventDefault(); // no text selection or native drag; vertical scrolling still works (touch-action: pan-y)
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (startX.current !== null) setDragX(e.clientX - startX.current);
  };
  const onUp = () => {
    if (startX.current === null) return;
    startX.current = null;
    setDragging(false);
    if (Math.abs(dragX) > THRESHOLD) void decide(dragX > 0);
    else setDragX(0);
  };
  // The browser took the gesture (a finger scrolling the profile): the card goes back, and it's never a swipe.
  const onCancel = () => {
    startX.current = null;
    setDragging(false);
    setDragX(0);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      void decide(true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      void decide(false);
    }
  };

  const x = leaving === "right" ? 700 : leaving === "left" ? -700 : dragX;
  const lean = Math.max(-1, Math.min(1, x / THRESHOLD));

  return (
    <div className="swipe-deck swipe-demo" tabIndex={0} onKeyDown={onKey} aria-label={`A demo card: ${top.name}. Right arrow likes, left arrow passes. Nothing is sent.`}>
      {done ? (
        <div className="swipe-empty card swipe-demo-done" role="status">
          <p className="swipe-empty-icon" aria-hidden="true">
            {done.liked ? "💘" : "👋"}
          </p>
          <p>
            <strong>{done.liked ? `You liked ${name}.` : `You passed on ${name}.`}</strong>
          </p>
          <p className="muted">That one was a demo, so nothing was sent.</p>
          <p className="swipe-demo-cta">Make a character to swipe for real — {name} likes back.</p>
          <p className="swipe-demo-buttons">
            <Link className="button" href={makeHref}>
              Make a character
            </Link>
            <button type="button" className="button-ghost" onClick={again}>
              See {name} again
            </button>
          </p>
        </div>
      ) : (
        <>
          <div className="swipe-stack">
            {next && <Card card={next} className="swipe-card swipe-next" behind />}
            <Card
              key={top.id}
              card={top}
              className={`swipe-card swipe-top${dragging ? " is-dragging" : ""}`}
              style={{ transform: `translateX(${x}px) rotate(${x / 18}deg)` }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
            >
              <span className="swipe-stamp swipe-stamp-like" style={{ opacity: Math.max(0, lean) }} aria-hidden="true">
                Like
              </span>
              <span className="swipe-stamp swipe-stamp-nope" style={{ opacity: Math.max(0, -lean) }} aria-hidden="true">
                Nope
              </span>
            </Card>
          </div>
          <div className="swipe-actions">
            <button type="button" className="swipe-btn swipe-btn-nope" onClick={() => void decide(false)} aria-label={`Pass on ${top.name}`}>
              ✕
            </button>
            <button type="button" className="swipe-btn swipe-btn-like" onClick={() => void decide(true)} aria-label={`Like ${top.name}`}>
              ♥
            </button>
          </div>
          <p className="swipe-keys muted small" aria-hidden="true">
            ← Pass · Like →
          </p>
        </>
      )}
    </div>
  );
}

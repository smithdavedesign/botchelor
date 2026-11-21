"use client";

import { useEffect, useState } from "react";
import Avatar from "../Avatar";
// Only the type: lib/house-deck.ts builds the cards on the server, so the whole cast never comes to the browser.
import type { DeckCard } from "@/lib/house-deck";

/** "Juniper, Dex and Sable": first names, joined as a sentence says them. */
export function firstNames(cards: readonly Pick<DeckCard, "name">[]): string {
  const names = cards.map((c) => c.name.split(/\s+/)[0]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

/** How long each card stays in front before the next one comes forward. */
export const TURN_MS = 3600;

/**
 * Three of the house cast taking turns as the example card beside an empty form (lib/house-deck.ts; the visual pop
 * audit's leftovers): a small stack, the front card complete and readable, the next two tucked behind. Every few
 * seconds the front one goes to the back. It stops on the card in front once the person types (`still`), while the
 * pointer rests on it, and never moves for someone who asked for less motion: then it's Juniper, still. Only the front
 * card is read out; the two behind are set dressing.
 */
export default function HouseDeck({ cards, still = false }: { cards: readonly DeckCard[]; still?: boolean }) {
  const [front, setFront] = useState(0);
  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (still || resting || cards.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setFront((n) => (n + 1) % cards.length), TURN_MS);
    return () => window.clearInterval(t);
  }, [still, resting, cards.length]);
  return (
    <div className="house-deck" onPointerEnter={() => setResting(true)} onPointerLeave={() => setResting(false)}>
      {cards.map((c, n) => {
        const place = (n - front + cards.length) % cards.length;
        return (
          <div key={c.id} className={`swipe-card wizard-deck-card house-deck-card is-${place === 0 ? "front" : place === 1 ? "next" : "back"}`} aria-hidden={place === 0 ? undefined : true}>
            <span className="badge wizard-deck-example-tag">From the house</span>
            <div className="swipe-photo">
              <Avatar seed={c.id} name={c.name} hue={c.hue} house portraitSrc={c.portrait} size={140} decorative />
            </div>
            <div className="swipe-body">
              <h2 className="swipe-name">
                {c.name}
                <span className="swipe-age">, {c.age}</span>
              </h2>
              <p className="swipe-bio">{c.bio}</p>
              <div className="swipe-prompt">
                <p className="swipe-prompt-q">Dealbreaker</p>
                <p className="swipe-prompt-a">{c.dealbreaker}</p>
              </div>
              <ul className="chips swipe-interests">
                {c.traits.map((t) => (
                  <li key={t} className="chip">
                    {t}
                  </li>
                ))}
              </ul>
              <p className="swipe-looking">
                <strong>Looking for:</strong> {c.want}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * On a phone's first step, where the deck beside the form doesn't fit: the three faces in a slim strip above the first
 * question, so the screen has somebody on it.
 */
export function HouseStrip({ cards }: { cards: readonly DeckCard[] }) {
  if (!cards.length) return null;
  return (
    <p className="house-strip">
      <span className="house-strip-faces" aria-hidden="true">
        {cards.map((c) => (
          <Avatar key={c.id} seed={c.id} name={c.name} hue={c.hue} house portraitSrc={c.portrait} size={36} decorative />
        ))}
      </span>
      <span>
        {firstNames(cards)} are on the show. Yours is a sentence away.
      </span>
    </p>
  );
}

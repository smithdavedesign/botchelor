"use client";

import type { ReactNode } from "react";
import Avatar from "../Avatar";
import { promptLabel, type CharacterExtras } from "@/lib/extras";

type Props = {
  seed: string;
  name: string;
  age: string;
  hue: number;
  portrait: string | null;
  bio: string;
  want: string;
  extras: CharacterExtras;
  /** Editing: the button that changes their picture, under the card. */
  picture?: ReactNode;
};

/**
 * How the swipe deck will show them (the design system's create screen, 2026-11-11: "How the deck sees them"), filled
 * in as the sheet is: the parts of a card on /swipe (app/swipe/SwipeDeck.tsx Card, from lib/swipes.ts toCard) in the
 * same order and with the same classes, and a quiet stand-in where a part is still empty. Beside the form on a wide
 * screen; a phone keeps the one-row preview above it.
 */
export default function DeckPreview({ seed, name, age, hue, portrait, bio, want, extras, picture }: Props) {
  const shown = name.trim() || "Your character";
  const job = [extras.occupation?.trim(), extras.hometown?.trim()].filter(Boolean).join(" · ");
  const prompts = (extras.prompts ?? []).filter((p) => p.answer?.trim());
  const interests = (extras.hobbies ?? []).filter((h) => h.trim());
  return (
    <aside className="wizard-deck" aria-label="How the deck sees them">
      <p className="kicker">How the deck sees them</p>
      <div className="swipe-card wizard-deck-card">
        <div className="swipe-photo">
          <Avatar seed={seed} name={name.trim() || "?"} hue={hue} portraitSrc={portrait} size={140} decorative />
        </div>
        <div className="swipe-body">
          <h2 className="swipe-name">
            {shown}
            {age.trim() && <span className="swipe-age">, {age.trim()}</span>}
          </h2>
          {job && <p className="swipe-job">{job}</p>}
          <p className={bio.trim() ? "swipe-bio" : "swipe-bio muted"}>{bio.trim() || "A short bio goes here."}</p>
          {prompts.map((p) => (
            <div key={p.id} className="swipe-prompt">
              <p className="swipe-prompt-q">{promptLabel(p.id)}</p>
              <p className="swipe-prompt-a">{p.answer}</p>
            </div>
          ))}
          {interests.length > 0 && (
            <ul className="chips swipe-interests">
              {interests.map((i) => (
                <li key={i} className="chip">
                  {i}
                </li>
              ))}
            </ul>
          )}
          <p className="swipe-looking">
            <strong>Looking for:</strong> {want.trim() || <span className="muted">what they want from a date</span>}
          </p>
        </div>
      </div>
      {picture}
    </aside>
  );
}

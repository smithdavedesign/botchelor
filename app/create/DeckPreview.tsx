"use client";

import type { ReactNode } from "react";
import Avatar from "../Avatar";
import HouseDeck from "./HouseDeck";
import { promptLabel, type CharacterExtras } from "@/lib/extras";
import type { DeckCard } from "@/lib/house-deck";

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
  /** Three of the house cast (lib/house-deck.ts): while the form is empty they take turns as the example. */
  examples?: readonly DeckCard[];
  /** The person is typing their sentence (one-sentence create): the house cards stop on the one in front. */
  typing?: boolean;
};

/**
 * The example character (2026-11-14 design audit: every field was empty with no hint, and the preview was a "?"). Its
 * words are the form's placeholders ("e.g. …", SHEET_EXAMPLE) and the preview's sample card while the form is empty.
 * Never a value: nothing here is put in a field.
 */
export const EXAMPLE = {
  name: "Marisol Vane",
  age: "31",
  bio: "Restores antique clocks and is late to everything. Keeps a list of strangers' dogs she has met, ranked.",
  traits: ["dry", "loyal", "chaotic"] as const,
  want: "Someone who argues about the best biscuit and loses gracefully",
  dealbreaker: "Clapping when the plane lands",
  job: "Clock restorer · Lisbon",
  prompt: { q: "The way to win me over is…", a: "Know which of your watches is fast, and by how much." },
  interests: ["Clocks", "Night swims", "Ranking dogs"],
} as const;

/** The form's placeholders: the example, said as one ("e.g. Marisol Vane"). */
export const SHEET_EXAMPLE = {
  name: `e.g. ${EXAMPLE.name}`,
  age: `e.g. ${EXAMPLE.age}`,
  bio: `e.g. ${EXAMPLE.bio}`,
  traits: EXAMPLE.traits.map((t) => `e.g. ${t}`),
  want: `e.g. ${EXAMPLE.want}`,
  dealbreaker: `e.g. ${EXAMPLE.dealbreaker}`,
} as const;

/**
 * How the swipe deck will show them (the design system's create screen, 2026-11-11: "How the deck sees them"), filled
 * in as the sheet is: the parts of a card on /swipe (app/swipe/SwipeDeck.tsx Card, from lib/swipes.ts toCard) in the
 * same order and with the same classes, and a quiet stand-in where a part is still empty. Beside the form on a wide
 * screen; a phone keeps the one-row preview above it.
 *
 * While nothing is typed yet it shows the example character, greyed and labelled Example, so the card reads as a card;
 * the first thing typed (a name, usually) switches it to their own, stand-ins and all.
 */
export default function DeckPreview({ seed, name, age, hue, portrait, bio, want, extras, picture, examples = [], typing = false }: Props) {
  const job = [extras.occupation?.trim(), extras.hometown?.trim()].filter(Boolean).join(" · ");
  const prompts = (extras.prompts ?? []).filter((p) => p.answer?.trim());
  const interests = (extras.hobbies ?? []).filter((h) => h.trim());
  const empty = !name.trim() && !age.trim() && !bio.trim() && !want.trim() && !job && !prompts.length && !interests.length && !portrait;
  // Three of the house cast take turns (app/create/HouseDeck.tsx; the visual pop audit's leftovers): real people from
  // the show, tagged as theirs, rather than the made-up example in initials.
  if (empty && examples.length > 0) {
    return (
      <aside className="wizard-deck" aria-label="How the deck sees them">
        <p className="kicker">How the deck sees them</p>
        <HouseDeck cards={examples} still={typing} />
        <p className="muted small wizard-deck-example-note">Three of the house cast, as the deck shows them. Yours fills in here as you type.</p>
        {picture}
      </aside>
    );
  }
  if (empty) {
    return (
      <aside className="wizard-deck" aria-label="How the deck sees them">
        <p className="kicker">How the deck sees them</p>
        <div className="swipe-card wizard-deck-card wizard-deck-example">
          <span className="badge wizard-deck-example-tag">Example</span>
          <div className="swipe-photo">
            <Avatar seed="deck-example" name={EXAMPLE.name} hue={hue} portraitSrc={null} size={140} decorative />
          </div>
          <div className="swipe-body">
            <h2 className="swipe-name">
              {EXAMPLE.name}
              <span className="swipe-age">, {EXAMPLE.age}</span>
            </h2>
            <p className="swipe-job">{EXAMPLE.job}</p>
            <p className="swipe-bio">{EXAMPLE.bio}</p>
            <div className="swipe-prompt">
              <p className="swipe-prompt-q">{EXAMPLE.prompt.q}</p>
              <p className="swipe-prompt-a">{EXAMPLE.prompt.a}</p>
            </div>
            <ul className="chips swipe-interests">
              {EXAMPLE.interests.map((i) => (
                <li key={i} className="chip">
                  {i}
                </li>
              ))}
            </ul>
            <p className="swipe-looking">
              <strong>Looking for:</strong> {EXAMPLE.want}
            </p>
          </div>
        </div>
        <p className="muted small wizard-deck-example-note">Yours fills in here as you type.</p>
        {picture}
      </aside>
    );
  }
  const shown = name.trim() || "Your character";
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

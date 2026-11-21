"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/app/Avatar";
import FaceLoop from "@/app/FaceLoop";
// Only the type: lib/companion-preview.ts reads it on the server and the page passes it down.
import type { CompanionPreview } from "@/lib/companion-preview";

/** The face at the top of the phone, as a contact's is: bigger than a list's. */
export const PHONE_FACE = 88;

/** How long the dots show before a bubble lands: longer for a longer line, within bounds. */
export function typingMs(line: string): number {
  return Math.min(2200, Math.max(900, line.length * 18));
}

/** The pause after a bubble lands before the next dots start. */
export const BEAT_MS = 500;

type RowState = "said" | "typing" | "waiting";

/** What each bubble shows, with `shown` of them landed and the next one being typed or not (pure). */
export function rowStates(count: number, shown: number, typing: boolean): RowState[] {
  return Array.from({ length: count }, (_, n) => (n < shown ? "said" : n === shown && typing ? "typing" : "waiting"));
}

/**
 * A phone with one of the house cast typing the first message a conversation opens with (lib/companion-preview.ts; the
 * visual pop audit's leftovers), with the thread's own pieces: the typing dots, the bubble's land (chat-in), the grouped
 * corners. Complete at rest: the server sends every bubble, and someone who asked for less motion, or whose browser
 * can't tell when it's on screen, keeps them. Otherwise it waits off screen with the dots and types each bubble in
 * once, as half of it comes into view. Every row keeps its bubble's height while it waits, so nothing under the
 * phone moves as the lines land.
 */
export default function CompanionPhone({ preview }: { preview: CompanionPreview }) {
  const { id, name, hue, portrait, lines, watch } = preview;
  const first = name.split(/\s+/)[0];
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState(lines.length);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!root || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timers: number[] = [];
    const play = () => {
      setShown(0);
      setTyping(true);
      let at = 0;
      lines.forEach((line, n) => {
        if (n > 0) timers.push(window.setTimeout(() => setTyping(true), at));
        at += typingMs(line);
        timers.push(
          window.setTimeout(() => {
            setTyping(false);
            setShown(n + 1);
          }, at),
        );
        at += BEAT_MS;
      });
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (e && e.intersectionRatio >= 0.5) {
          io.disconnect();
          play();
        } else {
          setShown(0);
          setTyping(true);
        }
      },
      { threshold: [0, 0.5] },
    );
    io.observe(root);
    return () => {
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [root, lines]);
  const states = rowStates(lines.length, shown, typing);
  return (
    <figure className="companion-phone" ref={setRoot}>
      <div className="companion-phone-screen">
        <div className="companion-phone-who">
          <FaceLoop id={id} radius={PHONE_FACE * 0.28}>
            <Avatar seed={id} name={name} hue={hue ?? 0} house portraitSrc={portrait} size={PHONE_FACE} decorative />
          </FaceLoop>
          <strong>{first}</strong>
          <span className="muted small">AI character · on the show</span>
        </div>
        <ol className="companion-phone-thread" aria-label={`${first}'s first message`}>
          {lines.map((line, n) => (
            <li key={n} className={`phone-msg phone-msg-them companion-phone-msg is-${states[n]}${n === 0 ? " starts" : ""}${n === lines.length - 1 ? " ends" : ""}`}>
              <p className="phone-bubble">{line}</p>
              {states[n] === "typing" && (
                <span className="phone-bubble chat-typing" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className={`companion-phone-watch small${shown < lines.length ? " is-waiting" : ""}`}>
          <Link href={watch} data-track="companion-phone-watch" data-track-character={id}>
            <span aria-hidden="true">▶</span> Watch the date
          </Link>
        </p>
      </div>
      <figcaption className="muted small">
        {first}&apos;s real first message. The house cast open with their last aired date.
      </figcaption>
    </figure>
  );
}

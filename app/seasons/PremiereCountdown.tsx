"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SECOND = 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const UNITS = [
  ["d", "days"],
  ["h", "hours"],
  ["m", "min"],
  ["s", "sec"],
] as const;

/** What's left until `at`, in whole days, hours, minutes and seconds (none below zero). */
export function leftUntil(at: number, now: number): { d: number; h: number; m: number; s: number } {
  const left = Math.max(0, Math.floor((at - now) / SECOND));
  return { d: Math.floor(left / 86_400), h: Math.floor((left % 86_400) / 3600), m: Math.floor((left % 3600) / 60), s: left % 60 };
}

/** Where the premiere stands at `now`: still to come, on the air (from its start to its room's end), or aired. */
export function premiereState(at: number, until: number, now: number): "soon" | "live" | "aired" {
  return now < at ? "soon" : now < until ? "live" : "aired";
}

type Props = {
  /** When it starts and when its room has played out (ISO; lib/sunday-premiere.ts nextPremiere, premiereEndsAt). */
  at: string;
  until: string;
  /** On the air when the server drew the page (nextPremiere's state "live"). */
  live: boolean;
  /** "The pilot, Meet the lead" (season-visuals.ts premiereLabel). */
  label: string;
  /** The time for everyone, in words: "Sunday 29 November, 23:00 UTC (6 pm ET, 3 pm PT)". */
  words: string;
  /** The room, once the pass the hour before has built it. */
  href: string | null;
};

/**
 * The next premiere's clock on a season's hero (the visual pop audit, 2026-11-20): days, hours, minutes and seconds to
 * it, then an ON AIR light while it plays. The server writes the time in words and the light as it stood then; the
 * numbers stay "--" until the page is live in the browser, so the HTML never disagrees with the browser's clock (no
 * hydration mismatch), then tick once a second. Complete at rest: the words carry the time without the numbers.
 */
export default function PremiereCountdown({ at, until, live: liveAtFirst, label, words, href }: Props) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), SECOND);
    return () => window.clearInterval(t);
  }, []);
  const start = Date.parse(at);
  const state = now === null ? (liveAtFirst ? "live" : "soon") : premiereState(start, Date.parse(until), now);
  const left = now === null ? null : leftUntil(start, now);
  // Before it starts the room's link is the seat; on the air, the room or what's on; once aired, what's on.
  const go = state === "soon" ? (href ? { to: href, words: "Take your seat" } : null) : state === "live" ? { to: href ?? "/watch", words: "Watch now" } : { to: "/watch", words: "Watch what's on" };
  return (
    <div className={`premiere-countdown is-${state}`} data-track-area="season-premiere">
      <p className="premiere-head">
        <span className="premiere-light">
          <span className="premiere-light-dot" aria-hidden="true" />
          {state === "live" ? "On air" : state === "aired" ? "Aired" : "Next"}
        </span>{" "}
        <strong className="premiere-label">{label}</strong>
      </p>
      {state === "soon" && (
        <p className="premiere-clock" role="timer" aria-label={`Starts ${words}`}>
          {UNITS.map(([k, unit]) => (
            <span key={k}>
              <b>{left ? (k === "d" ? String(left[k]) : pad(left[k])) : "--"}</b>
              <small>{unit}</small>
            </span>
          ))}
        </p>
      )}
      <p className="premiere-words">{words}</p>
      {go && (
        <p className="premiere-go">
          <Link className={state === "live" ? "button" : "button-ghost"} href={go.to} data-track="season-premiere-go">
            {go.words}
          </Link>
        </p>
      )}
    </div>
  );
}

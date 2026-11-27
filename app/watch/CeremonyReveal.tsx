"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/app/Avatar";
import { revealSteps, type NightFace, type RevealInput, type RevealStep } from "@/lib/ceremony-night";

/** How long each step holds before the next, while it plays. */
const STEP_MS = 2400;
const seenKey = (heldOn: string) => `ceremony-seen:${heldOn}`;

function Face({ f, size = 40 }: { f: NightFace; size?: number }) {
  return (
    <Link href={`/characters/${f.id}`} className="ceremony-face">
      <Avatar seed={f.id} name={f.name} hue={f.hue} house={f.house} portraitSrc={f.portrait} size={size} decorative />
      <span>{f.name}</span>
    </Link>
  );
}

function Step({ s }: { s: RevealStep }) {
  switch (s.kind) {
    case "open":
    case "close":
      return <p className="small botchelor-line">{s.line}</p>;
    case "vote":
      return (
        <div className="ceremony-step is-home">
          <Face f={s.face} />
          <p className="small">{s.line ?? `The audience sent ${s.face.name} home.`}</p>
        </div>
      );
    case "rose":
      return (
        <div className="ceremony-step is-rose">
          <span className="ceremony-rose" aria-hidden="true">🌹</span>
          <Face f={s.face} />
          <span className="muted small">
            rose {s.n} of {s.of}
          </span>
        </div>
      );
    case "last_rose":
      return (
        <div className="ceremony-step is-last">
          <p className="small">
            <strong>{s.line}</strong>
          </p>
          <div className="ceremony-faces">
            {s.faces.map((f) => (
              <Face key={f.id} f={f} size={56} />
            ))}
          </div>
        </div>
      );
    case "goes_to":
      return (
        <div className="ceremony-step is-rose">
          <span className="ceremony-rose" aria-hidden="true">🌹</span>
          <Face f={s.face} size={56} />
          <p className="small">{s.line ?? `The last rose goes to ${s.face.name}.`}</p>
        </div>
      );
    case "home":
      return (
        <div className="ceremony-step is-home">
          <Face f={s.face} />
          <p className="small">{s.line ?? `${s.face.name} goes home.`}</p>
        </div>
      );
    case "limo":
      return (
        <figure className="ceremony-step ceremony-limo">
          <figcaption className="kicker">In the limo · {s.face.name}</figcaption>
          {s.lines.map((l, i) => (
            <blockquote key={i} className="small">
              “{l}”
            </blockquote>
          ))}
        </figure>
      );
  }
}

/**
 * The last ceremony as television tells it (lib/ceremony-night.ts revealSteps): press play and the roses go out one at
 * a time, the last rose comes down to two faces, then who goes home and what they say in the limo. A viewer who has
 * seen it (or prefers it all at once) gets every step at once. `staged` false (CEREMONY_REVEAL=0): every step, no play.
 */
export default function CeremonyReveal({ last, staged }: { last: RevealInput; staged: boolean }) {
  const steps = revealSteps(last);
  // Staged: the result waits behind the play button from the first paint, so it never flashes before hydration.
  const [shown, setShown] = useState<number>(staged ? 0 : steps.length);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(seenKey(last.held_on)) === "1";
    } catch {
      seen = false;
    }
    // Seen already on this browser: the whole night at once.
    if (seen || !staged) setShown(steps.length);
  }, [last.held_on, staged, steps.length]);
  useEffect(() => {
    if (!playing) return;
    if (shown >= steps.length) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 300 : STEP_MS);
    return () => window.clearTimeout(t);
  }, [playing, shown, steps.length]);
  const markSeen = () => {
    try {
      window.localStorage.setItem(seenKey(last.held_on), "1");
    } catch {
      /* private window: it plays again next time */
    }
  };
  const play = () => {
    markSeen();
    setShown(0);
    setPlaying(true);
  };
  const all = () => {
    markSeen();
    setPlaying(false);
    setShown(steps.length);
  };
  const n = shown;
  return (
    <div className="ceremony-reveal" data-reveal={n >= steps.length ? "done" : playing ? "playing" : "waiting"}>
      {n === 0 && !playing ? (
        <p className="cta-row">
          <button type="button" className="primary small" onClick={play} data-track="ceremony-reveal-play">
            🌹 Watch the roses go out
          </button>{" "}
          <button type="button" className="button-ghost small" onClick={all} data-track="ceremony-reveal-skip">
            Just tell me
          </button>
        </p>
      ) : (
        <ol className="ceremony-steps" aria-live="polite">
          {steps.slice(0, n).map((s, i) => (
            <li key={i} className="ceremony-steps-item">
              <Step s={s} />
            </li>
          ))}
        </ol>
      )}
      {playing && n < steps.length && (
        <p>
          <button type="button" className="button-ghost small" onClick={all} data-track="ceremony-reveal-skip">
            Skip to the end
          </button>
        </p>
      )}
    </div>
  );
}

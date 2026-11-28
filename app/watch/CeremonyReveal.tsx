"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import Petals from "@/app/motion/Petals";
import SoundToggle from "@/app/motion/SoundToggle";
import { cue } from "@/app/motion/cues";
import ShareButton from "@/app/ShareButton";
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
          <span className="ceremony-rose" aria-hidden="true">
            <Icon name="rose" />
          </span>
          <Face f={s.face} />
          <span className="ceremony-count muted small">
            <span className="ceremony-pips" aria-hidden="true">
              {Array.from({ length: s.of }, (_, i) => (
                <span key={i} className={i < s.n ? "is-given" : undefined} />
              ))}
            </span>
            rose {s.n} of {s.of}
          </span>
        </div>
      );
    case "last_rose":
      return (
        <div className="ceremony-step is-last">
          <p className="small ceremony-hush">
            <strong>{s.line}</strong>
          </p>
          <div className="ceremony-faces">
            {s.faces.map((f, i) => (
              <span key={f.id} className="ceremony-faceoff">
                {i > 0 && (
                  <span className="ceremony-one-rose" aria-hidden="true">
                    <Icon name="rose" />
                  </span>
                )}
                <Face f={f} size={56} />
              </span>
            ))}
          </div>
        </div>
      );
    case "goes_to":
      return (
        <div className="ceremony-step is-rose is-final">
          <span className="ceremony-rose" aria-hidden="true">
            <Icon name="rose" />
          </span>
          <Face f={s.face} size={56} />
          <p className="small ceremony-verdict">{s.line ?? `The last rose goes to ${s.face.name}.`}</p>
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
          <span className="ceremony-limo-lights" aria-hidden="true" />
          <figcaption className="kicker">In the limo · {s.face.name}</figcaption>
          {s.lines.map((l, i) => (
            <blockquote key={i} className="small" style={{ "--i": i } as CSSProperties}>
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
  // Pressed play this visit: the newest step makes its entrance (app/ux/show-nights.css), even after the last one lands.
  const [played, setPlayed] = useState(false);
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
    const t = window.setTimeout(() => {
      // Each step's sound as it lands (app/motion/cues.ts; silent unless the viewer turned sound on).
      const next = steps[shown];
      if (next?.kind === "rose" || next?.kind === "goes_to") cue("chime");
      else if (next?.kind === "limo") cue("door");
      setShown((n) => n + 1);
    }, shown === 0 ? 300 : STEP_MS);
    return () => window.clearTimeout(t);
  }, [playing, shown, steps]);
  const markSeen = () => {
    try {
      window.localStorage.setItem(seenKey(last.held_on), "1");
    } catch {
      /* private window: it plays again next time */
    }
  };
  const play = () => {
    markSeen();
    cue("tear");
    setShown(0);
    setPlayed(true);
    setPlaying(true);
  };
  const all = () => {
    markSeen();
    setPlaying(false);
    setShown(steps.length);
  };
  const n = shown;
  return (
    <div className="ceremony-reveal" data-reveal={n >= steps.length ? "done" : playing ? "playing" : "waiting"} data-played={played || undefined}>
      {n === 0 && !playing ? (
        <p className="cta-row">
          <button type="button" className="primary small" onClick={play} data-track="ceremony-reveal-play">
            <Icon name="rose" /> Watch the roses go out
          </button>{" "}
          <button type="button" className="button-ghost small" onClick={all} data-track="ceremony-reveal-skip">
            Just tell me
          </button>{" "}
          <SoundToggle />
        </p>
      ) : (
        <ol className="ceremony-steps" aria-live="polite">
          {steps.slice(0, n).map((s, i) => (
            <li key={i} className="ceremony-steps-item" data-step={s.kind} data-fresh={i === n - 1 || undefined}>
              <Step s={s} />
            </li>
          ))}
        </ol>
      )}
      {/* The last rose lands: petals over the whole card, once, for a viewer who watched it go out. */}
      {played && steps.slice(0, n).some((s) => s.kind === "goes_to") && <Petals delay={0.5} />}
      {/* The night told: one tap shares it, as a link whose preview is the result card (app/api/og/ceremony). */}
      {n >= steps.length && steps.length > 0 && (
        <p className="ceremony-share">
          <ShareButton
            path={`/watch?ceremony=${last.held_on}#rose-ceremony`}
            title={last.finale ? "The final rose · The Botchelor" : `Week ${last.week}'s rose ceremony · The Botchelor`}
            label="Share the result"
            track="ceremony-share"
          />
        </p>
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

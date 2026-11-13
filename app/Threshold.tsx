"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

/**
 * The crossing between the show and After Dark (the design kit's Threshold): a full-screen, opaque beat so the move reads
 * as leaving one place for another, never as a theme change. Once a session each way (sessionStorage), on the side it
 * arrives at: After Dark's arrival ("Lights low. Doors locked.") and, coming back from it, "Back to the show". It goes by
 * itself after a moment; Continue, Escape or a tap end it sooner. Shown per the rollout switch (lib/adult/door.ts).
 */
export default function Threshold({ side, from }: { side: "after-dark" | "show"; from?: string | null }) {
  const [up, setUp] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const key = `bz-threshold:${side}`;
    try {
      if (sessionStorage.getItem(key)) return;
      // The show's side only greets someone coming back from After Dark's host.
      if (side === "show" && !(from && document.referrer.startsWith(from))) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    setUp(true);
  }, [side, from]);
  useEffect(() => {
    if (!up) return;
    button.current?.focus();
    const off = () => setUp(false);
    const timer = setTimeout(off, 1800);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") off();
      // The only control: focus stays on it.
      if (e.key === "Tab") (e.preventDefault(), button.current?.focus());
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [up]);
  if (!up) return null;
  const ad = side === "after-dark";
  return (
    <div className={`threshold threshold--${side}`} role="dialog" aria-modal="true" aria-label={ad ? "After Dark" : "Back to the show"} data-threshold={side} onClick={() => setUp(false)}>
      <span className="threshold-mark" aria-hidden="true">
        <Icon name={ad ? "moon" : "tv"} />
      </span>
      <p className="kicker">{ad ? "You've left the show" : "You've left After Dark"}</p>
      <p className="threshold-title">{ad ? "After Dark" : "Back to the show"}</p>
      <p className="threshold-note">{ad ? "Lights low. Doors locked." : "Everything here is PG again."}</p>
      <button ref={button} type="button" className={ad ? "button primary" : "button"} onClick={() => setUp(false)}>
        Continue
      </button>
    </div>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import Icon from "@/app/Icon";

/**
 * The show's one signature motion (the design system, 2026-11-11): a sealed envelope that unseals to lift a result
 * out. Sunday's reveal uses it: sealed while the vote is in and the secret is minutes away, opened once it's out. The
 * flap folds back, the envelope sinks away and the card inside is left standing, about 2.7 seconds, once per week per
 * browser (sessionStorage); after that, and under prefers-reduced-motion, it's simply open. Styles: `.reveal` in
 * app/ux/show.css.
 */
export default function Reveal({
  id,
  sealed = false,
  kicker,
  sealedTitle,
  sealedNote,
  who,
  line,
  detail,
  children,
}: {
  /** What this reveal is (the week), so the unseal plays once for it. */
  id: string;
  sealed?: boolean;
  kicker: string;
  /** The sealed state's words: "Sealed until Sunday, 7:20 pm UTC". */
  sealedTitle?: ReactNode;
  sealedNote?: ReactNode;
  /** The face on the card. */
  who?: ReactNode;
  /** The card's line: "Sable's secret is out". */
  line?: ReactNode;
  detail?: ReactNode;
  /** What follows the card once it's open: the result line, the way to the date. */
  children?: ReactNode;
}) {
  const key = `bz-reveal-seen-${id}`;
  const [state, setState] = useState<"sealed" | "opening" | "open">(sealed ? "sealed" : "open");
  useEffect(() => {
    if (sealed) {
      setState("sealed");
      return;
    }
    let seen = true;
    try {
      seen = sessionStorage.getItem(key) === "1";
      sessionStorage.setItem(key, "1");
    } catch {
      /* no storage: open at once */
    }
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen || reduced) {
      setState("open");
      return;
    }
    setState("opening");
    const t = setTimeout(() => setState("open"), 2700);
    return () => clearTimeout(t);
  }, [sealed, key]);
  return (
    <div className="reveal" data-state={state} aria-live="polite">
      <p className="kicker reveal-kicker">{kicker}</p>
      <div className="reveal-stage">
        <div className="envelope" aria-hidden={state !== "sealed" || undefined}>
          <span className="envelope-body" />
          <span className="envelope-flap" />
          <span className="envelope-seal">
            <Icon name={state === "sealed" ? "lock" : "unlock"} />
          </span>
        </div>
        {state !== "sealed" && (
          <div className="reveal-card">
            {who}
            {line && <p className="reveal-line">{line}</p>}
            {detail && <p className="reveal-detail muted small">{detail}</p>}
          </div>
        )}
      </div>
      {state === "sealed" ? (
        <>
          {sealedTitle && <p className="reveal-line reveal-sealed-title">{sealedTitle}</p>}
          {sealedNote && <p className="muted small reveal-sealed-note">{sealedNote}</p>}
        </>
      ) : (
        <div className="reveal-body">{children}</div>
      )}
    </div>
  );
}

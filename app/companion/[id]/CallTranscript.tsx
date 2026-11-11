"use client";

import { useEffect, useRef } from "react";
import { atBottom, lastFinished, type Transcript } from "@/lib/companion-call-transcript";

/**
 * The call screen's 💬 Transcript (lib/companion-call-transcript.ts): what's been said so far on this call. Your
 * words still being heard are muted at the end; their reply grows as it's said; a reply talked over ends "(cut off)".
 * It follows the newest line unless you've scrolled up to read back. Screen readers hear each finished line once.
 */
export default function CallTranscript({ id, script, name }: { id: string; script: Transcript; name: string }) {
  const list = useRef<HTMLOListElement>(null);
  // Following the newest line: until they scroll up, and again once they're back at the bottom.
  const stick = useRef(true);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [script]);

  const said = lastFinished(script);
  const who = (w: "you" | "them") => (w === "you" ? "You" : name);
  const empty = script.lines.length === 0 && !script.interim;

  return (
    <section className="companion-call-script" id={id} aria-label="Transcript">
      {empty ? (
        <p className="companion-call-script-empty">Nothing said yet. What you both say shows here as it&apos;s said.</p>
      ) : (
        <ol
          className="companion-call-script-lines"
          ref={list}
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = atBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
          }}
        >
          {script.lines.map((l) => (
            <li key={l.id} className={`companion-call-script-line is-${l.who}${l.done ? "" : " is-going"}`}>
              <span className="companion-call-script-who">{who(l.who)}</span> {l.text}
              {l.cut && <span className="companion-call-script-cut"> (cut off)</span>}
            </li>
          ))}
          {script.interim && (
            <li className="companion-call-script-line is-you is-interim" aria-hidden="true">
              <span className="companion-call-script-who">You</span> {script.interim}…
            </li>
          )}
        </ol>
      )}
      <p className="sr-only" aria-live="polite">
        {said ? `${who(said.who)}: ${said.text}${said.cut ? " (cut off)" : ""}` : ""}
      </p>
    </section>
  );
}

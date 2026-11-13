"use client";

import { useEffect, useRef, useState } from "react";

/** A prompt about this long or longer gets its "more" before the browser has measured anything (the server's guess). */
export const CLAMP_GUESS = 150;

/**
 * A library prompt's text on its card (app/prompts/PromptCard.tsx): clamped to four lines, "more" opens it, "less" folds it
 * back. The server renders the clamp and, for a long prompt, the button; once mounted the card measures itself and drops
 * a button the text never needed, so a short prompt is never told it has more.
 */
export default function PromptText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(text.length >= CLAMP_GUESS);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [open, text]);
  return (
    <div className="prompt-text-wrap">
      <p ref={ref} className={`prompt-text${open ? "" : " is-clamped"}`}>
        {text}
      </p>
      {long && (
        <button type="button" className="link-button prompt-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

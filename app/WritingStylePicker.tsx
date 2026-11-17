"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { WritingStyle } from "@/lib/narration";
import type { StyleSide } from "@/lib/writing-style";

const LABEL: Record<WritingStyle, string> = { script: "Script", narrated: "Narrated" };
const ABOUT: Record<StyleSide, Record<WritingStyle, string>> = {
  show: {
    script: "Lines and a short action, the way the show has always been written.",
    narrated: "Each line wrapped in prose, like a novel: what they do, what they notice, a flicker of what they think.",
  },
  adult: {
    script: "Lines and a short action, as every night has been written.",
    narrated: "Each line wrapped in prose, like a novel. Counts as two scene steps.",
  },
};

/**
 * How your dates and scenes are written (lib/narration.ts, lib/writing-style.ts): the script, or narrated prose around
 * each line. `side`: "show" for your dates and companion scenes, "adult" for After Dark. Admins only while it's tested
 * (the page only shows it to them). `price`: what narrated costs on top, said beside it.
 */
export default function WritingStylePicker({ side, initial, price }: { side: StyleSide; initial: WritingStyle; price?: string }) {
  const [style, setStyle] = useState<WritingStyle>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  async function pick(next: WritingStyle) {
    if (next === style || busy) return;
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/writing-style", { side, style: next }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't change it. Try again.", error: true });
    setStyle(next);
    setNote({ text: side === "show" ? `Your next dates and scenes are written as ${LABEL[next].toLowerCase()}.` : `Your next lines are written as ${LABEL[next].toLowerCase()}.` });
  }

  return (
    <section className="card writing-style" aria-labelledby={`writing-style-${side}`}>
      <h2 id={`writing-style-${side}`}>
        Writing style <span className="badge">admins</span>
      </h2>
      <div className="writing-style-options" role="radiogroup" aria-label="Writing style">
        {(["script", "narrated"] as const).map((s) => (
          <label key={s} className={`writing-style-option${style === s ? " on" : ""}`}>
            <input type="radio" name={`writing-style-${side}`} value={s} checked={style === s} disabled={busy} onChange={() => void pick(s)} />
            <span>
              <strong>{LABEL[s]}</strong>
              {s === "narrated" && price ? <span className="muted small"> · {price}</span> : null}
              <span className="muted small writing-style-about">{ABOUT[side][s]}</span>
            </span>
          </label>
        ))}
      </div>
      {note && (
        <p className={note.error ? "error small" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </section>
  );
}

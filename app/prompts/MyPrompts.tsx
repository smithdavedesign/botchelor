"use client";

import { useState } from "react";
import { PROMPT_MAX } from "@/lib/studio/library-limits";
import CopyPrompt from "./CopyPrompt";
import { useMyPrompts } from "./MyPromptsContext";

/**
 * Your own prompts, at the top of the library (David, 2026-10-25: "allow them to create and save prompts to this
 * library"): write one, or Save one from the list below; both Studios offer them under "Your prompts". Signed-out
 * visitors see one line saying so, and nothing asks the library for them; nothing here is indexed (it's drawn in the
 * browser). The list is the page's own (MyPromptsContext.tsx), shared with every card's Save.
 */
export default function MyPrompts() {
  const my = useMyPrompts();
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!my?.signedIn) {
    return (
      <p className="muted small my-prompts-signin">
        <a href="/account">Sign in</a> to save prompts of your own, and use them in your character&apos;s Studio.
      </p>
    );
  }
  const mine = my.prompts;
  if (!mine) return null;
  return (
    <section className="card my-prompts" aria-labelledby="my-prompts-title">
      <h2 id="my-prompts-title">✨ Your prompts</h2>
      <form
        className="my-prompts-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setNote(null);
          const res = await my.save(text);
          setBusy(false);
          if (!res.ok) return setNote({ text: res.message, error: true });
          setText("");
          setNote({ text: "Saved: it's in your Studio's Your prompts row." });
        }}
      >
        <textarea rows={2} value={text} maxLength={PROMPT_MAX} placeholder="Write your own: golden-hour portrait on a rooftop, wind in their hair…" onChange={(e) => setText(e.target.value)} aria-label="Your own prompt" />
        <button type="submit" className="primary" disabled={busy || !text.trim()}>
          Save prompt
        </button>
      </form>
      {note && (
        <p className={note.error ? "error small" : "notice small"} role="status">
          {note.text}
        </p>
      )}
      {mine.length > 0 ? (
        <ul className="prompts-list">
          {mine.map((p) => (
            <li key={p.id} className="prompt-item">
              <p className="prompt-text">{p.text}</p>
              <div className="prompt-meta">
                <span className="muted small">{p.mode === "safe" ? "🛡 Safe" : "🌙 After Dark"}</span>
                <CopyPrompt text={p.text} />
                <button type="button" className="linklike" onClick={() => void my.remove(p.id)}>
                  delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">None yet: write one above, or Save one from the library below.</p>
      )}
    </section>
  );
}

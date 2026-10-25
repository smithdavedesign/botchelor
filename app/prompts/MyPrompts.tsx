"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import { PROMPT_MAX, type MyPrompt } from "@/lib/studio/library";
import CopyPrompt from "./CopyPrompt";

/**
 * Your own prompts, at the top of the library (David, 2026-10-25: "allow them to create and save prompts to this
 * library"): write one, or Save one from the list below; both Studios offer them under "Your prompts". Signed-out
 * visitors see one line saying so; nothing here is indexed (it's drawn in the browser).
 */
export default function MyPrompts() {
  const [mine, setMine] = useState<MyPrompt[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    fetch("/api/library")
      .then((r) => {
        if (r.status === 401) setSignedOut(true);
        return r.ok ? r.json() : null;
      })
      .then((d) => d && setMine(d.library.prompts as MyPrompt[]))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  if (signedOut) {
    return (
      <p className="muted small my-prompts-signin">
        <a href="/account">Sign in</a> to save prompts of your own, and use them in your character&apos;s Studio.
      </p>
    );
  }
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
          const res = await requestJson("/api/library", { action: "save_prompt", text, mode: "safe" }).catch(() => null);
          setBusy(false);
          if (!res || !res.ok) return setNote({ text: res ? res.message : "That didn't reach the server.", error: true });
          setText("");
          setNote({ text: "Saved: it's in your Studio's Your prompts row." });
          void load();
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
                <button
                  type="button"
                  className="linklike"
                  onClick={async () => {
                    const res = await requestJson("/api/library", { action: "delete", kind: "prompt", id: p.id }).catch(() => null);
                    if (res?.ok) setMine((m) => (m ?? []).filter((x) => x.id !== p.id));
                  }}
                >
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

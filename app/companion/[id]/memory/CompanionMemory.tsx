"use client";

import { useState } from "react";
import Link from "next/link";
import { requestJson } from "@/app/request";
import type { CompanionCharacterRef, CompanionFactView } from "@/lib/companion-shared";

const KIND_LABELS: Record<string, string> = {
  name: "Your name",
  likes: "Likes",
  dislikes: "Dislikes",
  people: "People",
  events: "Happened",
  plans: "Plans",
  work: "Work",
  boundaries: "Not to bring up",
  jokes: "Inside jokes",
  other: "Other",
};

/**
 * What a companion knows about you (lib/companion-memory.ts): every fact it drew from what you said, and the ones you
 * added. Edit one and it's yours (never written over); pin one and it's always in mind; delete one, or forget everything.
 */
export default function CompanionMemory({ threadId, character, initial }: { threadId: string; character: CompanionCharacterRef; initial: CompanionFactView[] }) {
  const [facts, setFacts] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = character.name.split(/\s+/)[0] || character.name;

  async function edit(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const { ok, data, message } = await requestJson(`/api/companion/${threadId}/memory`, body);
      if (ok && Array.isArray(data.facts)) {
        setFacts(data.facts as CompanionFactView[]);
        return true;
      }
      setError(message);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
    return false;
  }

  return (
    <article className="companion-memory">
      <p>
        <Link href={`/companion/${threadId}`}>← Back to {first}</Link>
      </p>
      <h1>What {first} knows about you</h1>
      <p className="muted">
        {first} picks these up from what you say, a few messages at a time. Only you and {first} see them, and they never go anywhere else on the show. Edit one and{" "}
        {first} keeps your words; pin one and {first} always has it in mind.
      </p>

      <form
        className="companion-memory-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (adding.trim() && (await edit({ op: "add", text: adding }))) setAdding("");
        }}
      >
        <label htmlFor="memory-add">Tell {first} something to remember</label>
        <div className="row">
          <input id="memory-add" value={adding} onChange={(e) => setAdding(e.target.value)} maxLength={160} placeholder="My sister Maya is getting married in June." />
          <button type="submit" className="button secondary" disabled={busy || !adding.trim()}>
            Add
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {facts.length === 0 ? (
        <p className="muted">Nothing yet. Talk a little and {first} will start remembering.</p>
      ) : (
        <ul className="companion-facts">
          {facts.map((f) => (
            <li key={f.id} className={f.pinned ? "pinned" : undefined}>
              <span className="chip">{KIND_LABELS[f.kind] ?? f.kind}</span>
              {editing === f.id ? (
                <form
                  className="row"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await edit({ op: "edit", id: f.id, text })) setEditing(null);
                  }}
                >
                  <input value={text} onChange={(e) => setText(e.target.value)} maxLength={160} aria-label="The fact" autoFocus />
                  <button type="submit" className="button secondary small" disabled={busy}>
                    Save
                  </button>
                  <button type="button" className="button-ghost small" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span className="companion-fact-text">{f.text}</span>
                  <span className="companion-fact-tools">
                    <button type="button" className="button-ghost small" onClick={() => void edit({ op: "pin", id: f.id, pinned: !f.pinned })} disabled={busy} aria-pressed={f.pinned}>
                      {f.pinned ? "📌 Pinned" : "Pin"}
                    </button>
                    <button
                      type="button"
                      className="button-ghost small"
                      onClick={() => {
                        setEditing(f.id);
                        setText(f.text);
                      }}
                      disabled={busy}
                    >
                      Edit
                    </button>
                    <button type="button" className="button-ghost small" onClick={() => void edit({ op: "delete", id: f.id })} disabled={busy} aria-label={`Forget: ${f.text}`}>
                      Forget
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {facts.length > 0 && (
        <p>
          <button
            type="button"
            className="button-ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`${first} forgets everything about you, and the notes on your conversation too. Your messages stay. Go ahead?`)) void edit({ op: "forget_all" });
            }}
          >
            Forget everything
          </button>
        </p>
      )}
    </article>
  );
}

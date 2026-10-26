"use client";

import { useState } from "react";

/**
 * "What did you think of them?" for someone your character met at a group night without dating (the web's
 * remember_meeting): one line, private to you, carried into a later first date with them.
 */
export default function MetTake({ characterId, aboutId, aboutName, initial }: { characterId: string; aboutId: string; aboutName: string; initial: string | null }) {
  const [note, setNote] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}/met-notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ about: aboutId, note }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) setError(body.message ?? "That didn't save; try again in a moment.");
      else setSaved(note.trim());
    } catch {
      setError("That didn't save; try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="met-take"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        <span className="small">What did you think of {aboutName}? (private to you)</span>
        <input type="text" value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} placeholder="Funny, sharp, worth a real date…" />
      </label>
      <button type="submit" className="small" disabled={busy || !note.trim() || note.trim() === saved}>
        {busy ? "Saving…" : saved ? "Update" : "Remember"}
      </button>
      {saved && !busy && note.trim() === saved && <span className="muted small"> Saved: it rides into a first date with them.</span>}
      {error && (
        <span className="thread-action-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

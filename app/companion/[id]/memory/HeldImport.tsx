"use client";

import { useEffect, useState } from "react";
import { heldUsFor, sendHeldUsFor } from "@/app/import/held-history";

/**
 * Lines about the two of them that an import kept (lib/import-history.ts) but couldn't write when the character was
 * made, because this person couldn't text it yet. They waited in this browser; here, where the thread now exists, one
 * press adds them through the import's own route (the memory editor's checks), and the page reloads with them in.
 * Renders nothing when nothing waits. [data-private]: the lines are the person's, so the beacon records no click here.
 */
export default function HeldImport({ characterId, first }: { characterId: string; first: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setLines(heldUsFor(characterId));
  }, [characterId]);
  if (!lines.length) return null;

  async function add() {
    setBusy(true);
    setMessage(null);
    const note = await sendHeldUsFor(characterId);
    if (note?.kind === "kept") {
      window.location.reload();
      return;
    }
    setBusy(false);
    setMessage(note?.kind === "held" ? note.message : "They couldn't be added just now. Try again in a moment.");
  }

  return (
    <section className="card held-import" data-private aria-label="Brought with your import">
      <p>
        <strong>{lines.length === 1 ? "One line" : `${lines.length} lines`} you brought with {first} from another app:</strong>
      </p>
      <ul>
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p>
        <button type="button" className="button secondary" onClick={() => void add()} disabled={busy}>
          {busy ? "Adding…" : `Add ${lines.length === 1 ? "it" : "them"} to what ${first} knows`}
        </button>
      </p>
      {message && <p className="small">{message}</p>}
    </section>
  );
}

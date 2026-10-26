"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Pick which of your characters takes the date; the match is made with the date agreed, then on to their thread. */
export default function AcceptDateLink({ code, first, characters }: { code: string; first: string; characters: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pick, setPick] = useState(characters[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/date-links/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ character_id: pick }),
      });
      const body = (await res.json().catch(() => ({}))) as { thread?: string; message?: string };
      if (!res.ok || !body.thread) {
        setError(body.message ?? "That didn't work; try again in a moment.");
        setBusy(false);
        return;
      }
      router.push(body.thread);
    } catch {
      setError("That didn't work; try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <form
      className="date-link-accept"
      onSubmit={(e) => {
        e.preventDefault();
        void accept();
      }}
    >
      {characters.length > 1 && (
        <label>
          <span className="small">Who goes on the date?</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className="primary" disabled={busy || !pick}>
        {busy ? "Matching…" : `💘 Go on a date with ${first}${characters.length === 1 ? ` as ${characters[0].name.split(/\s+/)[0]}` : ""}`}
      </button>
      {error && (
        <p className="thread-action-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

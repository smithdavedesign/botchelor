"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { character_id: string; name: string; partner_id: string; partner_name: string };

const firstName = (name: string) => name.split(/\s+/)[0] || name;

/**
 * Pick which of your characters goes to the double (each with the house date the show deals them), then both tables
 * book and you're taken to yours, playing.
 */
export default function TakeDoubleLink({ code, options, datesLeft }: { code: string; options: Option[]; datesLeft: number }) {
  const router = useRouter();
  const [pick, setPick] = useState(options[0]?.character_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = options.find((o) => o.character_id === pick) ?? options[0];

  async function take() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/double-links/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ character_id: pick }),
      });
      const body = (await res.json().catch(() => ({}))) as { watch?: string; message?: string; episode_a?: string };
      if (res.ok && body.watch) {
        router.push(body.watch);
        return;
      }
      setError(body.message ?? "That didn't work; try again in a moment.");
      setBusy(false);
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
        void take();
      }}
    >
      {options.length > 1 && (
        <label>
          <span className="small">Who do you bring?</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            {options.map((o) => (
              <option key={o.character_id} value={o.character_id}>
                {o.name}, with {firstName(o.partner_name)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className="primary" disabled={busy || !pick || datesLeft < 1}>
        {busy ? "Booking both tables…" : `💞💞 Book the double${options.length === 1 && chosen ? ` as ${firstName(chosen.name)}` : ""}`}
      </button>
      <p className="muted small">
        {chosen ? `${firstName(chosen.name)}'s date is ${chosen.partner_name}, from this season's cast. ` : ""}
        {datesLeft < 1
          ? "It spends one of your dates, and you have none left right now."
          : `It spends one of your dates (${datesLeft} left).`}
      </p>
      {error && (
        <p className="thread-action-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

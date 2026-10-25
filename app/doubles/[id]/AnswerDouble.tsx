"use client";

import Link from "next/link";
import { useState } from "react";

/** Accept books both tables (yours spends one of your dates); decline says not this time. */
export default function AnswerDouble({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ declined?: boolean; episode_b?: string } | null>(null);

  async function answer(action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/doubles/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; episode_b?: string; declined?: string };
      if (!res.ok) setError(body.message ?? "That didn't work; try again in a moment.");
      else setDone(action === "decline" ? { declined: true } : { episode_b: body.episode_b });
    } catch {
      setError("That didn't work; try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (done?.declined) return <p className="muted">Declined — the other couple hears, and nothing was spent.</p>;
  if (done?.episode_b) {
    return (
      <p>
        Booked! Both tables are being written — <Link href={`/episodes/${done.episode_b}`}>watch your couple&apos;s date</Link>.
      </p>
    );
  }
  return (
    <p className="row-actions">
      <button type="button" className="primary" onClick={() => void answer("accept")} disabled={busy}>
        {busy ? "Booking…" : "Accept — book both tables"}
      </button>
      <button type="button" onClick={() => void answer("decline")} disabled={busy}>
        Not this time
      </button>
      <span className="muted"> Accepting spends one of your dates; theirs spends theirs.</span>
      {error && (
        <span className="thread-action-error" role="alert">
          {error}
        </span>
      )}
    </p>
  );
}

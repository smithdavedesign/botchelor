"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CharacterName from "@/app/CharacterName";

type Slot = { character_id: string; name: string; slot: number; source: "dealt" | "survivor" | "new" };
type Candidate = {
  character_id: string;
  name: string;
  archetype: string | null;
  status: "pending" | "approved" | "rejected";
  portrait: string | null;
  check_note: string | null;
};
type View = {
  this_season: { id: string; label: string; cast: Slot[] };
  next_season: { id: string; label: string; generate_from_day: number; candidates: Candidate[] };
  note?: string | null;
};

const SOURCE: Record<Slot["source"], string> = { dealt: "dealt", survivor: "stayed on", new: "new" };

/** The review queue: next month's candidates with their portraits, and this month's cast. Admin account or password. */
export default function SeasonPanel() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = (): Record<string, string> => {
    try {
      const key = localStorage.getItem("bz_frontier");
      return key ? { "x-frontier-key": key } : {};
    } catch {
      return {};
    }
  };

  async function call(body?: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/season", body ? { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify(body) } : { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.message ?? "Not authorized.");
    setView(data as View);
  }

  useEffect(() => {
    call().catch(() => setError("Network error."));
  }, []);

  async function act(key: string, body: Record<string, unknown>) {
    setBusy(key);
    await call(body).catch(() => setError("Network error."));
    setBusy(null);
  }

  if (error && !view) return <p className="error">{error}</p>;
  if (!view) return <p className="muted">Loading…</p>;
  const live = view.next_season.candidates.filter((c) => c.status !== "rejected");
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {view.note && (
        <p className="muted" role="status">
          {view.note}
        </p>
      )}
      <section className="card">
        <h2>Next season: {view.next_season.label}</h2>
        {view.next_season.candidates.length === 0 && (
          <p className="muted">No candidates yet. The daily job writes them from the {view.next_season.generate_from_day}th, or write them now.</p>
        )}
        <ul className="season-candidates">
          {view.next_season.candidates.map((c) => (
            <li key={c.character_id} className={`season-candidate is-${c.status}`}>
              {c.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.portrait} alt={`Portrait of ${c.name}`} />
              ) : (
                <p className="muted small">No portrait{c.check_note ? `: ${c.check_note}` : ""}</p>
              )}
              <p>
                <Link href={`/characters/${c.character_id}`}>
                  <strong>{c.name}</strong>
                </Link>{" "}
                <span className="muted">{c.archetype}</span> <span className="badge">{c.status}</span>
              </p>
              <p>
                <button type="button" className="primary small" disabled={busy !== null || c.status === "approved"} onClick={() => act(`a-${c.character_id}`, { action: "approve", character_id: c.character_id })}>
                  Approve
                </button>{" "}
                <button type="button" className="button-ghost small" disabled={busy !== null || c.status === "rejected"} onClick={() => act(`r-${c.character_id}`, { action: "reject", character_id: c.character_id })}>
                  Reject
                </button>{" "}
                <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => act(`p-${c.character_id}`, { action: "portrait", character_id: c.character_id })}>
                  {busy === `p-${c.character_id}` ? "Painting…" : "New portrait"}
                </button>
              </p>
            </li>
          ))}
        </ul>
        <p>
          <button type="button" className="primary" disabled={busy !== null || live.length >= 3} onClick={() => act("generate", { action: "generate" })}>
            {busy === "generate" ? "Writing… (a minute or two)" : live.length ? "Write replacements" : "Write the candidates now"}
          </button>
        </p>
      </section>
      <section className="card">
        <h2>This season: {view.this_season.label}</h2>
        <ol>
          {view.this_season.cast.map((s) => (
            <li key={s.character_id}>
              <CharacterName character={{ id: s.character_id, name: s.name }} /> <span className="muted">· {SOURCE[s.source]}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

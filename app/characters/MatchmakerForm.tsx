"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import type { CastMember } from "@/lib/mechanics";
import { POINTS_PER_MATCHMAKER } from "@/lib/rules";

/** Matchmakers (PRD): propose a pairing; earn points if a later date between them ends in a second date. */
export default function MatchmakerForm({ cast }: { cast: CastMember[] }) {
  const { busy, error, setError, run } = useAction();
  const [done, setDone] = useState(false);

  function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const character_a = String(form.get("a") ?? "");
    const character_b = String(form.get("b") ?? "");
    if (!character_a || !character_b) return setError("Pick two characters.");
    if (character_a === character_b) return setError("Pick two different characters.");
    void run(async () => {
      const result = await requestJson("/api/matchmakers", { character_a, character_b });
      if (result.ok) setDone(true);
      return result;
    });
  }

  return (
    <form className="card" onSubmit={propose}>
      <h2>Play matchmaker</h2>
      <p className="muted">
        Think two of the cast belong together? Propose the pairing. If a date between them ends in a second date, you
        earn {POINTS_PER_MATCHMAKER} points.
      </p>
      <div className="traits">
        <select name="a" aria-label="First character" defaultValue="">
          <option value="" disabled>
            First character
          </option>
          {cast.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="b" aria-label="Second character" defaultValue="">
          <option value="" disabled>
            Second character
          </option>
          {cast.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={busy}>
        Propose the match
      </button>
      {done && <p className="notice">Proposed. Watch for a date between them.</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

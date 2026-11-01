"use client";

import { useState, type FormEvent } from "react";
import Sheet from "@/app/Sheet";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import type { CastMember } from "@/lib/mechanics";
import { POINTS_PER_MATCHMAKER } from "@/lib/rules";

/**
 * Matchmakers (PRD): propose a pairing; earn points if a later date between them ends in a second date. A row on the
 * cast tab whose button opens the form in a modal (2026-10-31 UX audit: the whole form sat in the page, one more
 * screen on a phone).
 */
export default function MatchmakerForm({ cast }: { cast: CastMember[] }) {
  const { busy, error, setError, run } = useAction();
  const [open, setOpen] = useState(false);
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
    <section className="card invite-row matchmaker" aria-label="Play matchmaker">
      <span className="invite-row-icon" aria-hidden="true">
        💘
      </span>
      <div className="invite-row-text">
        <strong>Play matchmaker</strong>
        <span className="muted small">Pair two of the cast. If a date between them ends in a second date, you earn {POINTS_PER_MATCHMAKER} points.</span>
      </div>
      <button
        type="button"
        className="secondary"
        aria-haspopup="dialog"
        onClick={() => {
          setDone(false);
          setError(null);
          setOpen(true);
        }}
      >
        Pick a pair
      </button>
      <Sheet open={open} onClose={() => !busy && setOpen(false)} title="Play matchmaker">
        <form className="matchmaker-form" onSubmit={propose}>
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
          <div className="sheet-actions">
            <button type="submit" disabled={busy}>
              Propose the match
            </button>
          </div>
          {done && (
            <p className="notice" role="status">
              Proposed. Watch for a date between them.
            </p>
          )}
          {error && (
            <p className="sheet-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </Sheet>
    </section>
  );
}

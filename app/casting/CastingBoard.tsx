"use client";

import Link from "next/link";
import Avatar from "@/app/Avatar";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import type { CastingBoard as Board } from "@/lib/auditions";

/** The auditions as cards, each with its votes and a vote button (one vote a viewer, moved by voting again). */
export default function CastingBoard({ board, viewer }: { board: Board; viewer: string | null }) {
  const { busy, error, run } = useAction();
  const vote = (id: string) => run(() => requestJson("/api/casting", { character_id: id }));
  if (!board.auditions.length) {
    return (
      <section className="card">
        <p>No auditions yet for {board.label}. Be the first: open one of your characters and press <em>Audition</em>.</p>
      </section>
    );
  }
  return (
    <section aria-label={`Auditions for ${board.label}`}>
      {error && <p className="error small" role="alert">{error}</p>}
      <ul className="casting-grid">
        {board.auditions.map((a) => {
          const mine = board.my_vote === a.character_id;
          return (
            <li key={a.character_id} className={`card casting-card${mine ? " is-voted" : ""}`}>
              <Link href={`/characters/${a.character_id}`} className="casting-face">
                <Avatar seed={a.character_id} name={a.name} hue={a.hue} size={96} portraitSrc={a.portrait} decorative />
                <strong>{a.name}</strong>
              </Link>
              <p className="muted small casting-bio">{a.bio}</p>
              <p className="small">
                {a.status === "approved" && <span className="chip">Shortlisted</span>}{" "}
                <span className="muted">
                  {a.votes} vote{a.votes === 1 ? "" : "s"} · {a.aired} dates aired
                </span>
              </p>
              <button
                type="button"
                className={mine ? "button-ghost small" : "primary small"}
                aria-pressed={mine}
                disabled={busy || mine}
                onClick={() => vote(a.character_id)}
                data-track="audition-vote"
                title={viewer ? undefined : "Votes are one a viewer."}
              >
                {mine ? "Your vote" : board.my_vote ? "Move my vote here" : "Vote"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

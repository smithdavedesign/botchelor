"use client";

import Link from "next/link";
import Avatar from "@/app/Avatar";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import type { CastingBoard as Board } from "@/lib/auditions";
import { showCrowd } from "@/lib/crowd-threshold";

/**
 * The auditions as cards, each with its votes and a vote button (one vote a viewer, moved by voting again). The vote
 * counts show for a crowd or to an insider (the empty-room rule, lib/crowd-threshold.ts: "0 votes" under the only
 * applicant told a creator nobody was watching); the dates aired always show.
 */
export default function CastingBoard({ board, viewer, insider = false }: { board: Board; viewer: string | null; insider?: boolean }) {
  const { busy, error, run } = useAction();
  const vote = (id: string) => run(() => requestJson("/api/casting", { character_id: id }));
  const counts = showCrowd(board.auditions.reduce((s, a) => s + a.votes, 0), { insider });
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
              {a.creator_handle && a.creator_name && (
                <p className="small muted casting-credit">
                  by <Link href={`/creators/${a.creator_handle}`}>{a.creator_name}</Link>
                </p>
              )}
              <p className="muted small casting-bio">{a.bio}</p>
              <p className="small">
                {a.status === "approved" && <span className="chip">Shortlisted</span>}{" "}
                <span className="muted">
                  {counts ? `${a.votes} vote${a.votes === 1 ? "" : "s"} · ` : ""}
                  {a.aired} {a.aired === 1 ? "date" : "dates"} aired
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

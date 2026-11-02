"use client";

import Avatar from "./Avatar";
import { requestJson } from "./request";
import { useAction } from "./useAction";
import type { BackingBoard } from "@/lib/backing";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Back a cast member for the month (lib/backing.ts): the season's cast as faces, one pick per viewer, changeable until
 * mid-month. /watch shows the card; the character page shows BackThem below. Counts are shown, never who backed whom.
 */
export default function BackCast({ board }: { board: BackingBoard }) {
  const { busy, error, run } = useAction();
  const back = (id: string) => run(() => requestJson("/api/backing", { character_id: id }));
  const mine = board.my_pick;
  return (
    <section id="back-cast" className="card back-cast" aria-labelledby="back-cast-head">
      <p className="kicker">Back a cast member · {board.label}</p>
      <h2 id="back-cast-head">Who are you backing this month?</h2>
      <p className="muted small">
        Pick one. If they end the season coupled, you take the points and the badge.{" "}
        {board.locked ? "Picks are locked for the month — a first pick still counts." : `Change your mind until ${day(board.locks_at)}; then it's locked. No take-backs.`}
      </p>
      <ul className="cast-preview-faces back-cast-faces">
        {board.cast.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-pressed={mine === c.id}
              disabled={busy || (board.locked && mine !== null && mine !== c.id)}
              onClick={() => back(c.id)}
              data-track="back-cast"
              data-track-where="watch"
              title={mine === c.id ? `Your pick: ${c.name}` : `Back ${c.name}`}
            >
              <Avatar seed={c.id} name={c.name} hue={c.hue} house size={48} portraitSrc={c.portrait} decorative />
              <span className="small">{c.name}</span>
              {mine === c.id ? <span className="chip">Your pick</span> : c.backers > 0 ? <span className="muted small">{c.backers} backing</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error small">{error}</p>}
      {board.most && (
        <p className="muted small">
          Most backed this month: <strong>{board.most.name}</strong> ({board.most.backers} {board.most.backers === 1 ? "viewer" : "viewers"}
          {board.total > board.most.backers ? ` of ${board.total}` : ""}).
        </p>
      )}
    </section>
  );
}

/** The character page's one-liner: back this cast member (or your standing pick) for the month. */
export function BackThem({ characterId, name, board }: { characterId: string; name: string; board: BackingBoard }) {
  const { busy, error, run } = useAction();
  const mine = board.my_pick;
  const theirs = mine === characterId;
  return (
    <p className="small back-them">
      {theirs ? (
        <>
          <span aria-hidden="true">🏅</span> You&apos;re backing {name} for {board.label}.{" "}
          <span className="muted">{board.locked ? "Locked. No take-backs." : `If they end the season coupled, the points are yours.`}</span>
        </>
      ) : board.locked && mine !== null ? (
        <span className="muted">
          <span aria-hidden="true">🏅</span> Your pick for {board.label} is locked. No take-backs.
        </span>
      ) : (
        <>
          <button
            type="button"
            className="link-button"
            disabled={busy}
            onClick={() => run(() => requestJson("/api/backing", { character_id: characterId }))}
            data-track="back-cast"
            data-track-where="character"
          >
            🏅 Back {name} for {board.label}
          </button>{" "}
          <span className="muted">One pick a month: if they end the season coupled, you take the points.</span>
        </>
      )}
      {error && <span className="error"> {error}</span>}
    </p>
  );
}

"use client";

import Link from "next/link";
import Avatar from "./Avatar";
import { requestJson } from "./request";
import { useAction } from "./useAction";
import type { SituationBoard } from "@/lib/situations";

/** "in 5h", "in 40m": how long until the vote closes, from the server's clock (the page is dynamic). */
function closesIn(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
}

/**
 * Tonight's situation (lib/situations.ts): two of the house cast, three situations to vote between, and how the last
 * vote went with the room to watch it in. The counts show once you've voted. Home and /watch both show it.
 */
export default function SituationVote({ board, now }: { board: SituationBoard; now: number }) {
  const { busy, error, run } = useAction();
  const [a, b] = board.cast;
  const voted = board.my_pick !== null;
  const vote = (pick: string) => run(() => requestJson("/api/situation", { pick }));
  return (
    <section id="situation" className="card situation" aria-labelledby="situation-head">
      <div className="situation-head">
        <span className="situation-avatars" aria-hidden="true">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house size={40} decorative />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house size={40} decorative />
        </span>
        <div>
          <p className="kicker">Tonight&apos;s situation · you pick</p>
          <h2 id="situation-head">
            {a.name} × {b.name}: what happens on their date?
          </h2>
          <p className="muted small">
            Most votes wins; they play it after the vote closes in {closesIn(board.closes_at, now)}.{" "}
            {voted ? `${board.total} ${board.total === 1 ? "vote" : "votes"} so far.` : "Vote to see how it's going."}
          </p>
        </div>
      </div>
      <ul className="situation-choices">
        {board.choices.map((c) => {
          const mine = board.my_pick === c.id;
          const share = board.total ? Math.round((c.votes / board.total) * 100) : 0;
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`situation-choice${mine ? " mine" : ""}`}
                aria-pressed={mine}
                disabled={busy}
                onClick={() => vote(c.id)}
              >
                <span className="situation-title">
                  <span aria-hidden="true">{c.icon}</span> {c.title}
                  {mine && <span className="chip">Your pick</span>}
                </span>
                <span className="situation-premise">{c.premise}</span>
                {voted && (
                  <span className="situation-bar" aria-label={`${share}% of votes`}>
                    <span style={{ width: `${share}%` }} />
                    <em>{share}%</em>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="error small">{error}</p>}
      {board.last && (
        <p className="situation-last small">
          <span aria-hidden="true">{board.last.icon}</span> Last vote: <strong>{board.last.title}</strong> won with {board.last.votes} of{" "}
          {board.last.total} for {board.last.cast[0]} × {board.last.cast[1]}
          {board.last.my_pick ? (board.last.won ? " (your pick)" : " (not yours this time)") : ""}.{" "}
          <Link href={board.last.room_path}>Watch how it went →</Link>
        </p>
      )}
    </section>
  );
}

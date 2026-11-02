"use client";

import Link from "next/link";
import Avatar from "./Avatar";
import { requestJson } from "./request";
import { useAction } from "./useAction";
import type { DareBoard } from "@/lib/dares";

/**
 * Tonight's dare (lib/dares.ts): the ballot's second lane. Viewers back one of three producer dares; the winner is
 * slipped to one side of tomorrow's house date, and the other side never knows. The counts show once you've voted.
 */
export default function DareVote({ board }: { board: DareBoard }) {
  const { busy, error, run } = useAction();
  const voted = board.my_pick !== null;
  const vote = (pick: string) => run(() => requestJson("/api/dare", { pick }));
  return (
    <section id="dare" className="card situation dare" aria-labelledby="dare-head">
      <div className="situation-head">
        <span className="situation-avatars" aria-hidden="true">
          <Avatar seed={board.target.id} name={board.target.name} hue={board.target.hue} house size={40} decorative />
        </span>
        <div>
          <p className="kicker">Tonight&apos;s dare · you pick</p>
          <h2 id="dare-head">Dare {board.target.name} to…</h2>
          <p className="muted small">
            The producers slip the winning dare to {board.target.name} — their date won&apos;t know.{" "}
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
                data-track="dare-vote"
              >
                <span className="situation-title">
                  <span aria-hidden="true">😈</span> {c.text}
                  {mine && <span className="chip">Your dare</span>}
                </span>
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
          <span aria-hidden="true">😈</span> Last dare: the producers dared <strong>{board.last.name}</strong> to {lowerFirst(board.last.text)}
          {board.last.my_pick ? (board.last.won ? " (your dare)" : " (not yours this time)") : ""}{" "}
          {board.last.aired ? (
            <>
              — {board.last.followed === true ? "they went through with it." : board.last.followed === false ? "they chickened out." : "did they go through with it? You decide."}{" "}
              {board.last.episode_path && <Link href={board.last.episode_path}>See the date →</Link>}
            </>
          ) : (
            board.last.episode_path && <Link href={board.last.episode_path}>Watch whether they go through with it →</Link>
          )}
        </p>
      )}
    </section>
  );
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

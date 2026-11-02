"use client";

import Link from "next/link";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import type { RecouplingBoard } from "@/lib/recoupling";

/** "tonight", "in 3 days", "in 5h": the countdown to the night, from the server's clock (the page is dynamic). */
function runsIn(iso: string, now: number): string {
  const mins = Math.round((Date.parse(iso) - now) / 60_000);
  if (mins <= 0) return "any minute";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours < 6 ? `tonight (in ${hours}h)` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The Recoupling (lib/recoupling.ts): the countdown to the season's one-room night, the audience's one vote before it
 * (counts show once you've voted, like the situation vote), and the last night's room to watch.
 */
export default function RecouplingCard({ board, now }: { board: RecouplingBoard; now: number }) {
  const { busy, error, run } = useAction();
  const voted = board.my_pick !== null;
  const vote = (pick: string) => run(() => requestJson("/api/recoupling", { pick }));
  const upcoming = Date.parse(board.runs_at) > now && board.choices.length > 0;
  return (
    <section className="card watch-recoupling" aria-labelledby="recoupling-head" data-track-area="recoupling">
      <p className="kicker">Season special · one room, every couple</p>
      <h2 id="recoupling-head">💘 The Recoupling {upcoming || Date.parse(board.runs_at) > now ? runsIn(board.runs_at, now) : ""}</h2>
      {board.choices.length > 0 ? (
        <>
          <p className="muted small">
            {board.ask} Most votes becomes the producer&apos;s nudge on the night — the characters still decide everything.{" "}
            {voted ? `${board.total} ${board.total === 1 ? "vote" : "votes"} so far.` : "Vote to see how it's going."}
          </p>
          <p className="watch-recoupling-choices">
            {board.choices.map((c) => (
              <span key={c.id}>
                <button
                  type="button"
                  className={board.my_pick === c.id ? "primary small" : "button-ghost small"}
                  disabled={busy}
                  data-track="recoupling-vote"
                  onClick={() => vote(c.id)}
                >
                  {c.label}
                  {voted ? ` · ${c.votes}` : ""}
                </button>{" "}
              </span>
            ))}
          </p>
        </>
      ) : (
        Date.parse(board.runs_at) > now && <p className="muted small">The couples and singles of the season share one room, and pairs can re-form. The vote opens closer to the night.</p>
      )}
      {board.last && (
        <p className="muted small">
          {board.last.winner_label ? `Last time the audience picked ${board.last.winner_label}. ` : ""}
          <Link href={board.last.room_path} data-track="recoupling-room">
            Watch the last Recoupling →
          </Link>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

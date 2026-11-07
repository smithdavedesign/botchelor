"use client";

import { requestJson } from "./request";
import { useAction } from "./useAction";
import type { SeasonBallot } from "@/lib/season-vote";

/** "in 12 days", "in 5h": how long the ballot stays open. */
function closesIn(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  if (mins >= 2 * 24 * 60) return `${Math.floor(mins / (24 * 60))} days`;
  return mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
}

/**
 * Next season's show (lib/season-vote.ts): every format on one ballot, one vote a viewer, changeable until the month
 * ends; the winner is next month's format. Counts show once you've voted, like tonight's situation.
 */
export default function SeasonFormatVote({ ballot, now }: { ballot: SeasonBallot; now: number }) {
  const { busy, error, run } = useAction();
  const voted = ballot.my_pick !== null;
  const vote = (pick: string) => run(() => requestJson("/api/season-vote", { pick }));
  const leading = ballot.choices.find((c) => c.slug === ballot.leading);
  return (
    <section id="next-season" className="card situation season-vote" aria-labelledby="season-vote-head" data-track-area="season-vote">
      <p className="kicker">Next season · you pick the show</p>
      <h2 id="season-vote-head">What should {ballot.season_label} be?</h2>
      <p className="muted small">
        Every format is the same cast with a different twist. Most votes wins (at least {ballot.min_votes} votes, or it&apos;s a classic month); voting closes in{" "}
        {closesIn(ballot.closes_at, now)}.{" "}
        {voted
          ? `${ballot.total} ${ballot.total === 1 ? "vote" : "votes"} so far${leading ? `: ${leading.title} is ahead.` : "."}`
          : "Vote to see how it's going."}
      </p>
      <ul className="situation-choices season-vote-choices">
        {ballot.choices.map((c) => {
          const mine = ballot.my_pick === c.slug;
          const share = ballot.total ? Math.round((c.votes / ballot.total) * 100) : 0;
          return (
            <li key={c.slug}>
              <button type="button" className={`situation-choice${mine ? " mine" : ""}`} aria-pressed={mine} disabled={busy} onClick={() => vote(c.slug)}>
                <span className="situation-title">
                  <span aria-hidden="true">{c.emoji}</span> {c.title}
                  {c.slug === ballot.current && <span className="chip">On now</span>}
                  {mine && <span className="chip">Your pick</span>}
                </span>
                <span className="situation-premise">{c.pitch}</span>
                {voted && (
                  <span className="situation-bar">
                    <span style={{ width: `${share}%` }} aria-hidden="true" />
                    <em>
                      {share}%<span className="sr-only"> of votes</span>
                    </em>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

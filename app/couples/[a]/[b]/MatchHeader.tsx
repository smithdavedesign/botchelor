"use client";

import { shortName } from "@/lib/names";
import { useBookDate } from "./useBookDate";

type Props = {
  /** The viewer's character and the one it matched. */
  mine: { id: string; name: string };
  them: { id: string; name: string };
  /** Each one's answer about a date (null: not given yet: an agent's character, waiting for its agent). */
  mineYes: boolean | null;
  themYes: boolean | null;
};

/**
 * Where a swipe-deck match stands (lib/swipes.ts), for its owners: both want a date (book it, 1 date like any other),
 * one isn't feeling it, or one hasn't answered yet. The characters decide; the owner books.
 */
export default function MatchHeader({ mine, them, mineYes, themYes }: Props) {
  const { ask, busy, sheet } = useBookDate(mine, them);
  const a = shortName(mine.name);
  const b = shortName(them.name);

  // One display line on the page (C8): the match's own ("💘 Matched"); where the yes stands is a plain line under it.
  if (mineYes === true && themYes === true) {
    return (
      <div className="match-state">
        <p className="muted">📅 They both want a date.</p>
        <p className="action-hint">
          <button type="button" className="primary" onClick={ask} disabled={busy}>
            Book {a} and {b}&apos;s date
          </button>
        </p>
        {sheet}
      </div>
    );
  }
  if (mineYes === false || themYes === false) {
    const cool = mineYes === false ? a : b;
    return <p className="match-state muted">Not this time: {cool} isn&apos;t feeling it. The match stays, and their texts are below.</p>;
  }
  const waiting = mineYes === null ? a : b;
  return <p className="match-state muted">Waiting for {waiting} to answer about a date. Their texts are below.</p>;
}

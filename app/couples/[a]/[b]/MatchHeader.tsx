"use client";

import Link from "next/link";
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
 * Where a swipe-deck match stands (lib/swipes.ts), for its owners: both want a date (book it, 1 token like any date),
 * one isn't feeling it, or one hasn't answered yet. The characters decide; the owner books.
 */
export default function MatchHeader({ mine, them, mineYes, themYes }: Props) {
  const { book, busy, message } = useBookDate(mine.id, them.id);
  const a = shortName(mine.name);
  const b = shortName(them.name);

  if (mineYes === true && themYes === true) {
    return (
      <div className="match-state">
        <p className="ending">📅 They both want a date.</p>
        <button type="button" className="primary" onClick={() => void book()} disabled={busy}>
          {busy ? "Booking…" : `Book ${a} and ${b}'s date`}
        </button>{" "}
        <span className="muted small">1 token, like any date. Everything they texted goes with them.</span>
        {message && (
          <p className="error">
            {message.text}
            {message.shop && (
              <>
                {" "}
                <Link href="/shop">Get tokens</Link>
              </>
            )}
          </p>
        )}
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

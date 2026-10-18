"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";
import { shortName } from "@/lib/names";

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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; shop?: boolean } | null>(null);
  const a = shortName(mine.name);
  const b = shortName(them.name);

  async function book() {
    setBusy(true);
    setMessage(null);
    const res = await requestJson("/api/episodes", { character_id: mine.id, partner_id: them.id }).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again." });
    if (res.ok && typeof res.data.id === "string") return router.push(`/episodes/${res.data.id}?play=1`);
    setMessage({ text: res.message, shop: res.status === 402 || res.status === 429 });
  }

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

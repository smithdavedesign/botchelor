"use client";

import Link from "next/link";
import { useBookDate } from "@/app/couples/[a]/[b]/useBookDate";
import type { NextStep } from "@/lib/inbox";

/**
 * The thread header's one action (David, 2026-10-18: "move the button to the top, no label"): Book date when both
 * want one (a double date is in ⋯), Watch live while it's filmed, ▶ Last date after, Swipe for others when one said
 * not this time. Nothing while they're still deciding: the stage under the name says where they are. On a phone it
 * says just its verb (📅 Book, 💘 Swipe, 🎬 Watch), so the name keeps its room.
 */
export default function ThreadNext({ next, mine, them }: { next: NextStep | null; mine: { id: string; name: string }; them: { id: string; name: string } }) {
  const { ask, busy, sheet } = useBookDate(mine, them);
  const mineId = mine.id;
  if (!next) return null;
  if (next.kind === "book") {
    return (
      <span className="thread-action">
        <button type="button" className="primary small" onClick={ask} disabled={busy}>
          📅 Book<span className="thread-wide-word"> date</span>
        </button>
        {sheet}
      </span>
    );
  }
  // 2026-10-25 page review: "Not this time" was a dead end (no action at all). The way forward: the deck again.
  if (next.kind === "declined") {
    return (
      <Link className="button small thread-action" href={`/swipe?character=${encodeURIComponent(mineId)}`}>
        💘 Swipe<span className="thread-wide-word"> for others</span>
      </Link>
    );
  }
  if (next.kind === "filming") {
    return (
      <Link className="button small thread-action" href={`/episodes/${next.episode_id}?play=1`}>
        🎬 Watch<span className="thread-wide-word"> live</span>
      </Link>
    );
  }
  if (next.kind === "dated") {
    return (
      <Link className="button small thread-action" href={`/episodes/${next.episode_id}`}>
        ▶ Last date
      </Link>
    );
  }
  return null;
}

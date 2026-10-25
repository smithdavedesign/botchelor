"use client";

import Link from "next/link";
import { useBookDate } from "@/app/couples/[a]/[b]/useBookDate";
import DoublePicker from "./DoublePicker";
import type { NextStep } from "@/lib/inbox";

/**
 * The thread header's one action (David, 2026-10-18: "move the button to the top, no label"): Book date when both
 * want one, Watch live while it's filmed, ▶ Last date after. Nothing while they're still deciding: the stage
 * under the name says where they are.
 */
export default function ThreadNext({ next, mineId, themId }: { next: NextStep | null; mineId: string; themId: string }) {
  const { book, busy, message } = useBookDate(mineId, themId);
  if (!next) return null;
  if (next.kind === "book") {
    return (
      <span className="thread-action">
        <button type="button" className="primary small" onClick={() => void book()} disabled={busy}>
          {busy ? "Booking…" : "📅 Book date"}
        </button>
        <DoublePicker mineId={mineId} themId={themId} />
        {message && (
          <span className="thread-action-error" role="alert">
            {message.text} {message.shop && <Link href="/shop">Get tokens</Link>}
          </span>
        )}
      </span>
    );
  }
  if (next.kind === "filming") {
    return (
      <Link className="button small thread-action" href={`/episodes/${next.episode_id}?play=1`}>
        🎬 Watch live
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

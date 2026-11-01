"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";

/**
 * ⋯ on the thread header: Unmatch (David, 2026-10-31: "dont allow users to undo a match when swiping they have to do
 * that in their messages"). Offered while the two haven't been on a date (lib/unmatch.ts: after one they're a couple,
 * and a block from that date's page stops them meeting). It opens as the double picker's panel, which asks first since
 * it's for good; then it's back to this character's Matches, where the thread has gone.
 */
export default function Unmatch({ mineId, themId, mineName, themName, back }: { mineId: string; themId: string; mineName: string; themName: string; back: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unmatch() {
    setBusy(true);
    setError(null);
    const r = await requestJson("/api/matches", { character_id: mineId, with: themId }, "DELETE").catch(() => null);
    if (r?.ok) {
      router.replace(back);
      router.refresh();
      return;
    }
    setBusy(false);
    setError(r?.message ?? "That didn't work; try again in a moment.");
  }

  return (
    <span className="thread-more">
      <button type="button" className="phone-head-btn" aria-expanded={open} aria-label={`More: unmatch ${themName}`} title="More" onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="double-panel" role="dialog" aria-label={`Unmatch ${themName}`}>
          <div className="double-panel-head">
            <strong>Unmatch {themName}?</strong>
            <button type="button" className="small double-panel-close" aria-label="Close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <p className="muted small">
            Their chat ends: {mineName} and {themName} won&apos;t text, go on a date or meet in the deck again. It can&apos;t be undone.
          </p>
          <div className="double-group">
            <button type="button" className="small danger" onClick={() => void unmatch()} disabled={busy}>
              {busy ? "Unmatching…" : "💔 Unmatch"}
            </button>
            <button type="button" className="small" onClick={() => setOpen(false)} disabled={busy}>
              Keep the match
            </button>
          </div>
          {error && (
            <p className="thread-action-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </span>
  );
}

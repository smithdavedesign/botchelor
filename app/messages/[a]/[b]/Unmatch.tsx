"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Sheet from "@/app/Sheet";
import { requestJson } from "@/app/request";

/**
 * Unmatch, the last item in the thread header's ⋯ (David, 2026-10-31: "dont allow users to undo a match when swiping
 * they have to do that in their messages"). Offered while the two haven't been on a date (lib/unmatch.ts: after one
 * they're a couple, and a block from that date's page stops them meeting). It asks first, in a modal, since it's for
 * good; then it's back to this character's Matches, where the thread has gone.
 */
export default function Unmatch({ mineId, themId, mineName, themName, back }: { mineId: string; themId: string; mineName: string; themName: string; back: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
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

  const close = () => {
    if (busy) return;
    setAsking(false);
    setError(null);
  };
  return (
    <>
      <button type="button" role="menuitem" className="thread-menu-item danger" data-close onClick={() => setAsking(true)}>
        <span aria-hidden="true">💔</span> Unmatch {themName}
      </button>
      <Sheet open={asking} onClose={close} title={`Unmatch ${themName}?`}>
        <p>
          Their chat ends: {mineName} and {themName} won&apos;t text, go on a date or meet in the deck again. Nobody is told, and it can&apos;t be undone.
        </p>
        <div className="sheet-actions">
          <button type="button" className="button-ghost" onClick={close} disabled={busy}>
            Keep the match
          </button>
          <button type="button" className="button-danger" onClick={() => void unmatch()} disabled={busy}>
            {busy ? "Unmatching…" : "💔 Unmatch"}
          </button>
        </div>
        {error && (
          <p className="sheet-error" role="alert">
            {error}
          </p>
        )}
      </Sheet>
    </>
  );
}

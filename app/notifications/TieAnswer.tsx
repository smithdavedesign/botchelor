"use client";

import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

/**
 * Yes and No on a tie proposal's notice (lib/social/declare.ts answerTie; the social network PRD section 6.2): another
 * owner says their character and yours know each other, and this answers it where it's read. The character's People
 * tab has the same two buttons.
 */
export default function TieAnswer({ characterId, tieId }: { characterId: string; tieId: string }) {
  const { busy, error, run } = useAction();
  const answer = (yes: boolean) => run(() => requestJson(`/api/characters/${encodeURIComponent(characterId)}/circle`, { action: "answer_tie", tie_id: tieId, answer: yes ? "yes" : "no" }));
  return (
    <span className="notif-answer">
      <button type="button" className="small" disabled={busy} onClick={() => void answer(true)}>
        Yes
      </button>
      <button type="button" className="secondary small" disabled={busy} onClick={() => void answer(false)}>
        No
      </button>
      {error && (
        <span className="sheet-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

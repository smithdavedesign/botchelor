"use client";

import { useState } from "react";
import { ProfileFields, saveProfileFrom } from "./ProfileFields";
import { useAction } from "./useAction";

/**
 * "Put my name on the board" (lib/streaks.ts best callers): saves a display name through the same path leagues and creator
 * reveals use (POST /api/profile: the content filter, one person per name, the 18+ attestation), so the board shows it
 * instead of "A viewer". `folded`: a link that opens the form (the 🔮 calls line); otherwise the form itself (the board).
 */
export default function BoardName({ folded = false }: { folded?: boolean }) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(!folded);
  if (!open) {
    return (
      <button type="button" className="link-button board-name-open" onClick={() => setOpen(true)}>
        Put my name on the board
      </button>
    );
  }
  return (
    <form
      className="board-name"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(() => saveProfileFrom(form));
      }}
    >
      <ProfileFields />
      <button type="submit" className="small" disabled={busy}>
        {busy ? "Saving…" : "Put my name on the board"}
      </button>
      {error && <p className="error small">{error}</p>}
      <p className="muted small">It shows on the best callers board and in leagues you join. You can change it any time.</p>
    </form>
  );
}

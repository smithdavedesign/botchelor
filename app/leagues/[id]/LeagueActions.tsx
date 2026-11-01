"use client";

import { useState, type FormEvent } from "react";
import { ProfileFields, saveProfileFrom } from "@/app/ProfileFields";
import Sheet from "@/app/Sheet";
import ShareLink from "@/app/ShareLink";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

/**
 * Joining, under the league's title (2026-10-31 UX audit: Join was ~1,000px down a phone, under the board and the points
 * rules). With a display name already, one tap joins; without one, a modal asks for it first.
 */
export function JoinLeague({ leagueId, hasName }: { leagueId: string; hasName: boolean }) {
  const { busy, error, run } = useAction();
  const [asking, setAsking] = useState(false);

  function join(form?: FormData) {
    void run(async () => {
      if (form) {
        const failure = await saveProfileFrom(form);
        if (failure) return failure;
      }
      return requestJson(`/api/leagues/${leagueId}/join`);
    });
  }

  return (
    <div className="league-join">
      <button type="button" disabled={busy} onClick={() => (hasName ? join() : setAsking(true))}>
        {busy && !asking ? "Joining…" : "Join this league"}
      </button>
      <p className="muted small">Your display name and this season&apos;s points show on the board. Nothing else about you does.</p>
      {error && !asking && <p className="error">{error}</p>}
      <Sheet open={asking} onClose={() => !busy && setAsking(false)} title="Join this league">
        <form
          className="league-join-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            join(new FormData(event.currentTarget));
          }}
        >
          <p className="muted">The name the board shows for you. Your points show beside it; nothing else about you does.</p>
          <ProfileFields />
          <div className="sheet-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Joining…" : "Join"}
            </button>
          </div>
          {error && (
            <p className="sheet-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </Sheet>
    </div>
  );
}

/** A member's invite link, from a button beside the league's title, in a modal. */
export function InviteFriends({ invitePath }: { invitePath: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Invite friends
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Invite friends">
        <p className="muted">Anyone with this link can see the board and join.</p>
        <ShareLink path={invitePath} label="League invite link" />
      </Sheet>
    </>
  );
}

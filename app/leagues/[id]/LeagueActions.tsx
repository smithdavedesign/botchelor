"use client";

import type { FormEvent } from "react";
import { ProfileFields, saveProfileFrom } from "@/app/ProfileFields";
import ShareLink from "@/app/ShareLink";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

type Props = { leagueId: string; invitePath: string; isMember: boolean; hasName: boolean };

export default function LeagueActions({ leagueId, invitePath, isMember, hasName }: Props) {
  const { busy, error, run } = useAction();

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      if (!hasName) {
        const failure = await saveProfileFrom(form);
        if (failure) return failure;
      }
      return requestJson(`/api/leagues/${leagueId}/join`);
    });
  }

  return (
    <section className="card">
      {!isMember && (
        <form onSubmit={join}>
          <h2>Join this league</h2>
          <p className="muted">Your display name and weekly points show on this board. Nothing else about you does.</p>
          {!hasName && <ProfileFields />}
          <button type="submit" disabled={busy}>
            Join
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
      <h2>Invite friends</h2>
      <p className="muted">Anyone with this link can see the board and join.</p>
      <ShareLink path={invitePath} label="League invite link" />
    </section>
  );
}

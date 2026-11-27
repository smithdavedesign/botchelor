"use client";

import Link from "next/link";
import Avatar from "@/app/Avatar";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import type { TournamentChar, TournamentMatch } from "@/lib/tournaments";

function Side({ c, votes, share, mine, won, open, busy, onVote }: {
  c: TournamentChar | null;
  votes: number | null;
  share: number | null;
  mine: boolean;
  won: boolean;
  open: boolean;
  busy: boolean;
  onVote: () => void;
}) {
  if (!c) return <div className="tn-side tn-empty">To be decided</div>;
  const face = <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={40} decorative />;
  const body = (
    <>
      {face}
      <span className="tn-name">
        <span className="tn-seed">{c.seed}</span> {c.name}
        {mine && <span className="chip">Your pick</span>}
        {won && <span className="chip">Through</span>}
      </span>
      {votes !== null && (
        <span className="tn-count">
          {votes} · {share}%
        </span>
      )}
      {share !== null && (
        <span className="tn-bar" aria-hidden="true">
          <span style={{ width: `${share}%` }} />
        </span>
      )}
    </>
  );
  return open ? (
    <button type="button" className={`tn-side${mine ? " mine" : ""}`} aria-pressed={mine} disabled={busy} onClick={onVote} data-track="tournament-vote">
      {body}
    </button>
  ) : (
    <Link className={`tn-side${won ? " won" : ""}`} href={`/characters/${c.id}`}>
      {body}
    </Link>
  );
}

/** One match: two characters, a vote while it's open (counts once you've voted), and who went through once it closed. */
export default function MatchVote({ tournamentId, m }: { tournamentId: string; m: TournamentMatch }) {
  const { busy, error, run } = useAction();
  const open = m.state === "open";
  const total = m.votes ? m.votes.a + m.votes.b : 0;
  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const vote = (pick: string) => run(() => requestJson("/api/tournament", { tournament_id: tournamentId, match: m.match, pick }));
  return (
    <div className={`tn-match tn-${m.state}`}>
      <Side
        c={m.a}
        votes={m.votes ? m.votes.a : null}
        share={m.votes ? share(m.votes.a) : null}
        mine={!!m.a && m.my_pick === m.a.id}
        won={!!m.a && m.winner?.id === m.a.id}
        open={open}
        busy={busy}
        onVote={() => m.a && vote(m.a.id)}
      />
      <span className="tn-vs" aria-hidden="true">
        vs
      </span>
      <Side
        c={m.b}
        votes={m.votes ? m.votes.b : null}
        share={m.votes ? share(m.votes.b) : null}
        mine={!!m.b && m.my_pick === m.b.id}
        won={!!m.b && m.winner?.id === m.b.id}
        open={open}
        busy={busy}
        onVote={() => m.b && vote(m.b.id)}
      />
      {error && (
        <p className="form-error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

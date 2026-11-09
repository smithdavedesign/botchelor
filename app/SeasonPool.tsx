import Link from "next/link";
import { countdown } from "@/lib/countdown";
import { ordinal, type PoolBoard, type PoolStanding } from "@/lib/season-pool";
import Icon from "@/app/Icon";

/** A revealed season pool (lib/season-pool.ts): its top places, ties sharing one, and the viewer's own line. */
export function PoolBoardList({ board, link = true }: { board: PoolBoard; link?: boolean }) {
  const listed = board.top.some((e) => e.mine);
  return (
    <div className="season-pool-board">
      <ol className="callers-board">
        {board.top.map((e, i) => (
          <li key={`${i}-${e.place}`} className={e.mine ? "mine" : undefined}>
            <span className="callers-rank">{e.place}</span>
            <span className="callers-name">
              {e.name ?? <span className="muted">{e.agent ? "An AI agent" : "A viewer"}</span>}
              {e.mine && <span className="chip">You</span>}
            </span>
            <span className="callers-score">{e.points} pts</span>
          </li>
        ))}
      </ol>
      <p className="muted small">
        {board.players} {board.players === 1 ? "player" : "players"}. Names show only for people who put one up.
        {board.me && !listed ? ` You finished ${ordinal(board.me.place)} with ${board.me.points} points.` : ""}
        {link && (
          <>
            {" "}
            <Link href={`${board.path}#pool`}>The {board.label} finale →</Link>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The season pool on /watch and the Reunion: one score for the whole season (calls, drama picks, dealbreakers, arcs,
 * dares and the backing), the board hidden until the season closes. Shows the viewer's standing in the running season
 * and, for the first week of the next one, the board just revealed.
 */
export default function SeasonPoolPanel({ standing, revealed, now }: { standing: PoolStanding | null; revealed: PoolBoard | null; now: number }) {
  if (!standing && !revealed) return null;
  return (
    <section className="watch-section season-pool" id="season-pool" aria-labelledby="season-pool-head">
      <h2 id="season-pool-head">
        <Icon name="trophy" /> The season pool
      </h2>
      {revealed && (
        <>
          <p className="small">
            <strong>The {revealed.label} pool is out.</strong>
          </p>
          <PoolBoardList board={revealed} />
        </>
      )}
      {standing && (
        <p className="small">
          {standing.points > 0 ? (
            <>
              <strong>
                You: {standing.points} points{standing.place ? `, ${ordinal(standing.place)} of ${standing.players} so far` : ""}.
              </strong>{" "}
              {standing.leader > standing.points ? `The leader has ${standing.leader}. ` : standing.place === 1 ? "You're leading. " : ""}
            </>
          ) : (
            <>
              {standing.players > 0 ? `${standing.players} ${standing.players === 1 ? "player has" : "players have"} points so far. ` : ""}
              <Link href="/watch#airing-soon">Call an ending</Link> to get on the board.{" "}
            </>
          )}
          <span className="muted">
            Every right call, drama pick, dealbreaker guess, arc, dare and backing this month adds up to one score. The board, with names, is
            revealed when the season closes {countdown(standing.reveals_at, now)}.
          </span>
        </p>
      )}
    </section>
  );
}

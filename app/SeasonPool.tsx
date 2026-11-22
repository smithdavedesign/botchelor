import Link from "next/link";
import { countdown, lastNightOf } from "@/lib/countdown";
import { crowdLine, showCrowd } from "@/lib/crowd-threshold";
import { ordinal, type PoolBoard, type PoolStanding } from "@/lib/season-pool";
import Icon from "@/app/Icon";

/**
 * A revealed season pool (lib/season-pool.ts): its top places, ties sharing one, and the viewer's own line. The player
 * count obeys the empty-room rule (lib/crowd-threshold.ts): a stranger reads "players" only once there's a crowd.
 */
export function PoolBoardList({ board, link = true, insider = false }: { board: PoolBoard; link?: boolean; insider?: boolean }) {
  const listed = board.top.some((e) => e.mine);
  const players = crowdLine(board.players, { one: "player", many: "players" }, { insider });
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
        {players ? `${players}. ` : ""}Names show only for people who put one up.
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
export default function SeasonPoolPanel({ standing, revealed, now, insider = false }: { standing: PoolStanding | null; revealed: PoolBoard | null; now: number; insider?: boolean }) {
  if (!standing && !revealed) return null;
  // "N players have points so far": only to someone with a character, or once N is a crowd (lib/crowd-threshold.ts).
  const players = standing ? crowdLine(standing.players, { one: "player has", many: "players have" }, { insider }) : "";
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
          <PoolBoardList board={revealed} insider={insider} />
        </>
      )}
      {standing && (
        <p className="small">
          {standing.points > 0 ? (
            <>
              <strong>
                You: {standing.points} points{standing.place ? `, ${ordinal(standing.place)}${showCrowd(standing.players, { insider }) ? ` of ${standing.players}` : ""} so far` : ""}.
              </strong>{" "}
              {standing.leader > standing.points ? `The leader has ${standing.leader}. ` : standing.place === 1 ? "You're leading. " : ""}
            </>
          ) : (
            <>
              {players ? `${players} points so far. ` : ""}
              <Link href="/watch#airing-soon">Call an ending</Link> to get on the board.{" "}
            </>
          )}
          <span className="muted">
            Every right call, drama pick, dealbreaker guess, arc, dare and backing this month adds up to one score. The board, with names, is
            revealed when the season closes {countdown(lastNightOf(standing.reveals_at), now)}.
          </span>
        </p>
      )}
    </section>
  );
}

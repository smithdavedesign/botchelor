import Link from "next/link";
import BoardName from "./BoardName";
import { recordLine, BOARD_DAYS, type CallRecord, type CallersBoard } from "@/lib/streaks";

/**
 * Your calls (lib/streaks.ts), in one line: your record and run when you have one, else the invitation to make one. Home
 * shows it under tonight's vote, pointing at the dates you can still call; /watch shows it under "Airing soon".
 */
/** `nameless`: a viewer with calls and no display name gets "Put my name on the board" (app/BoardName.tsx). */
export function CallsLine({ record, airing, href, nameless = false }: { record: CallRecord; airing: number; href?: string; nameless?: boolean }) {
  const open = airing > 0 ? `${airing} ${airing === 1 ? "date" : "dates"} airing soon` : null;
  const lead =
    record.called > 0 ? (
      <>
        <strong>Your calls:</strong> {recordLine(record)}
        {record.streak >= 2 ? " 🔥" : ""}
      </>
    ) : (
      <strong>Call the ending before a date airs</strong>
    );
  return (
    <div className="calls-line">
      <span aria-hidden="true">🔮</span> {lead}
      {open && (
        <>
          {" · "}
          {href ? <Link href={href}>{record.streak >= 2 ? `keep it going: ${open} →` : `${open} →`}</Link> : open}
        </>
      )}
      {nameless && record.right > 0 && (
        <>
          {" · "}
          <BoardName folded />
        </>
      )}
    </div>
  );
}

/** This week's best callers, by display name or "A viewer"; you're marked, and told your place when you're off the list. */
/** `nameless`: the viewer has no display name yet, so the board offers to put one on it (app/BoardName.tsx). */
export function CallersBoardPanel({ board, nameless = false }: { board: CallersBoard; nameless?: boolean }) {
  if (!board.top.length) return null;
  const listed = board.top.some((e) => e.mine);
  return (
    <section className="watch-section" aria-labelledby="best-callers">
      <h2 id="best-callers">Best callers this week</h2>
      <ol className="callers-board">
        {board.top.map((e, i) => (
          <li key={`${i}-${e.name}`} className={e.mine ? "mine" : undefined}>
            <span className="callers-rank">{i + 1}</span>
            <span className="callers-name">
              {e.name ?? <span className="muted">A viewer</span>}
              {e.mine && <span className="chip">You</span>}
            </span>
            <span className="callers-score">
              {e.right} of {e.called}
            </span>
          </li>
        ))}
      </ol>
      <p className="muted small">
        Right endings on public dates that aired in the last {BOARD_DAYS} days ({board.callers}{" "}
        {board.callers === 1 ? "caller" : "callers"}). Names show only for people who put one up.
        {board.my_rank && !listed ? ` You're number ${board.my_rank} this week.` : ""}
      </p>
      {/* On the board as "A viewer": the form, open. Not on it yet: a link to it. */}
      {nameless && <BoardName folded={!board.my_rank} />}
    </section>
  );
}

import Link from "next/link";
import { recordLine, BOARD_DAYS, type CallRecord, type CallersBoard } from "@/lib/streaks";

/**
 * Your calls (lib/streaks.ts), in one line: your record and run when you have one, else the invitation to make one. Home
 * shows it under tonight's vote, pointing at the dates you can still call; /watch shows it under "Airing soon".
 */
export function CallsLine({ record, airing, href }: { record: CallRecord; airing: number; href?: string }) {
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
    <p className="calls-line">
      <span aria-hidden="true">🔮</span> {lead}
      {open && (
        <>
          {" · "}
          {href ? <Link href={href}>{record.streak >= 2 ? `keep it going: ${open} →` : `${open} →`}</Link> : open}
        </>
      )}
    </p>
  );
}

/** This week's best callers, by display name; you're marked, and told your place when you're off the list. */
export function CallersBoardPanel({ board }: { board: CallersBoard }) {
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
              {e.name}
              {e.mine && <span className="chip">You</span>}
            </span>
            <span className="callers-score">
              {e.right} of {e.called}
            </span>
          </li>
        ))}
      </ol>
      <p className="muted small">
        Right endings on public dates that aired in the last {BOARD_DAYS} days. Only people with a display name are listed
        {board.unnamed > 0 ? ` (${board.unnamed} more called one right without one)` : ""}; joining a{" "}
        <Link href="#leagues">league</Link> gives you one.
        {board.my_rank && !listed ? ` You're number ${board.my_rank} this week.` : ""}
      </p>
    </section>
  );
}

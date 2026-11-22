import Link from "next/link";
import BoardName from "./BoardName";
import { showCrowd } from "@/lib/crowd-threshold";
import ShareRecord from "./ShareRecord";
import { tonightOf, type RecordShare } from "@/lib/share-record";
import { signShare, type Sharer } from "@/lib/share-record-name";
import { recordLine, BOARD_DAYS, BOARD_NAMED_MIN, type CallRecord, type CallersBoard } from "@/lib/streaks";

/**
 * Your calls (lib/streaks.ts), in one line: your record and run when you have one, else the invitation to make one. Home
 * shows it under tonight's vote, pointing at the dates you can still call; /watch shows it under "Airing soon".
 */
/** `nameless`: a viewer with calls and no display name gets "Put my name on the board" (app/BoardName.tsx). */
export function CallsLine({
  record,
  airing,
  href,
  nameless = false,
  sharer = null,
  where = "calls-line",
}: {
  record: CallRecord;
  airing: number;
  href?: string;
  nameless?: boolean;
  /** The viewer's own display name (lib/share-record-name.ts sharerOf): their shared link says whose calls they are. */
  sharer?: Sharer | null;
  /** data-track-where on the Share button. */
  where?: string;
}) {
  const share = shareOf(record, new Date(), sharer);
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
      {/* The spoiler-free share card (lib/share-record.ts): squares only, never which date or how it ended. */}
      {share && (
        <>
          {" "}
          <ShareRecord share={share} where={where} />
        </>
      )}
    </div>
  );
}

/**
 * The share card's numbers from a record that has its recent calls; null with nothing called yet. With a sharer (a
 * display name that's theirs alone), the link carries it, signed (lib/share-record-name.ts).
 */
export function shareOf(record: CallRecord, now: Date = new Date(), sharer: Sharer | null = null): RecordShare | null {
  if (!record.called || !record.recent?.length) return null;
  // With calls this week, the card is the week's ("4 of 5 this week", 2026-11-07 audit item 10); else the latest calls.
  const week = record.week && record.week.called > 0 && record.week.recent.length ? record.week : null;
  return signShare(
    {
      recent: week ? week.recent : record.recent,
      right: record.right,
      called: record.called,
      streak: record.streak,
      best: record.best,
      ...tonightOf(now),
      ...(week ? { week: { right: week.right, called: week.called } } : {}),
    },
    sharer,
  );
}

/**
 * This week's best callers, by display name or "A viewer"; you're marked, and told your place when you're off the list.
 * `nameless`: the viewer has no display name yet, so the board offers to put one on it (app/BoardName.tsx). The
 * empty-room rule (lib/crowd-threshold.ts): a board of two names tells a stranger they're alone, so below the threshold
 * they get the invitation to call an ending instead; someone with a character sees the board from one caller.
 */
export function CallersBoardPanel({ board, nameless = false, insider = false }: { board: CallersBoard; nameless?: boolean; insider?: boolean }) {
  if (!board.top.length) return null;
  const listed = board.top.some((e) => e.mine);
  // A board of mostly "A viewer" rows says nobody's here, to an insider too (the 2026-11-22 audit): the list waits for
  // BOARD_NAMED_MIN names. Meanwhile someone on it sees their place, and the form to put their name up.
  if (!showCrowd(board.callers, { insider }) || board.named < BOARD_NAMED_MIN) {
    return (
      <section className="watch-section" aria-labelledby="best-callers">
        <h2 id="best-callers">Best callers this week</h2>
        <p className="calls-line">
          <span aria-hidden="true">🔮</span> <strong>Call the ending before a date airs</strong> and your name goes up here.{" "}
          <Link href="/calls#open-calls">Tonight&apos;s open calls →</Link>
        </p>
        {board.my_rank && <p className="muted small">{`You're number ${board.my_rank} this week. The list shows once ${BOARD_NAMED_MIN} callers have put a name up.`}</p>}
        {nameless && board.my_rank && <BoardName folded />}
      </section>
    );
  }
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
        Right endings on public dates that aired in the last {BOARD_DAYS} days ({board.callers} {board.callers === 1 ? "caller" : "callers"}). Names show
        only for people who put one up.
        {board.my_rank && !listed ? ` You're number ${board.my_rank} this week.` : ""}
      </p>
      {/* On the board as "A viewer": the form, open. Not on it yet: a link to it. */}
      {nameless && <BoardName folded={!board.my_rank} />}
    </section>
  );
}

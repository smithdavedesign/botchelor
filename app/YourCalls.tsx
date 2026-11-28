import Link from "next/link";
import { english, type T } from "@/lib/i18n/translate";
import BoardName from "./BoardName";
import { fillNodes } from "./fillNodes";
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
  t = english,
}: {
  record: CallRecord;
  airing: number;
  href?: string;
  nameless?: boolean;
  /** The viewer's own display name (lib/share-record-name.ts sharerOf): their shared link says whose calls they are. */
  sharer?: Sharer | null;
  /** data-track-where on the Share button. */
  where?: string;
  /** The page's translator (docs/i18n.md); English when none is passed. */
  t?: T;
}) {
  const share = shareOf(record, new Date(), sharer);
  const open = airing > 0 ? (airing === 1 ? t("1 date airing soon") : t("{n} dates airing soon", { n: airing })) : null;
  const lead =
    record.called > 0 ? (
      <>
        <strong>{t("Your calls:")}</strong> {recordLine(record, t)}
        {record.streak >= 2 ? " 🔥" : ""}
      </>
    ) : (
      <strong>{t("Call the ending before a date airs")}</strong>
    );
  return (
    <div className="calls-line">
      <span aria-hidden="true">🔮</span> {lead}
      {open && (
        <>
          {" · "}
          {href ? <Link href={href}>{record.streak >= 2 ? `${t("keep it going: {open}", { open })} →` : `${open} →`}</Link> : open}
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
export function CallersBoardPanel({ board, nameless = false, insider = false, t = english }: { board: CallersBoard; nameless?: boolean; insider?: boolean; t?: T }) {
  if (!board.top.length) return null;
  const listed = board.top.some((e) => e.mine);
  // A board of mostly "A viewer" rows says nobody's here, to an insider too (the 2026-11-22 audit): the list waits for
  // BOARD_NAMED_MIN names. Meanwhile someone on it sees their place, and the form to put their name up.
  if (!showCrowd(board.callers, { insider }) || board.named < BOARD_NAMED_MIN) {
    return (
      <section className="watch-section" aria-labelledby="best-callers">
        <h2 id="best-callers">{t("Best callers this week")}</h2>
        <p className="calls-line">
          <span aria-hidden="true">🔮</span> {fillNodes(t("{call} and your name goes up here."), { call: <strong>{t("Call the ending before a date airs")}</strong> })}{" "}
          <Link href="/calls#open-calls">{t("Tonight's open calls")} →</Link>
        </p>
        {board.my_rank && <p className="muted small">{t("You're number {rank} this week. The list shows once {n} callers have put a name up.", { rank: board.my_rank, n: BOARD_NAMED_MIN })}</p>}
        {nameless && board.my_rank && <BoardName folded />}
      </section>
    );
  }
  return (
    <section className="watch-section" aria-labelledby="best-callers">
      <h2 id="best-callers">{t("Best callers this week")}</h2>
      <ol className="callers-board">
        {board.top.map((e, i) => (
          <li key={`${i}-${e.name}`} className={e.mine ? "mine" : undefined}>
            <span className="callers-rank">{i + 1}</span>
            <span className="callers-name">
              {e.name ?? <span className="muted">{t("A viewer")}</span>}
              {e.mine && <span className="chip">{t("You")}</span>}
            </span>
            <span className="callers-score">
              {t("{right} of {called}", { right: e.right, called: e.called })}
            </span>
          </li>
        ))}
      </ol>
      <p className="muted small">
        {board.callers === 1
          ? t("Right endings on public dates that aired in the last {days} days (1 caller). Names show only for people who put one up.", { days: BOARD_DAYS })
          : t("Right endings on public dates that aired in the last {days} days ({n} callers). Names show only for people who put one up.", { days: BOARD_DAYS, n: board.callers })}
        {board.my_rank && !listed ? ` ${t("You're number {rank} this week.", { rank: board.my_rank })}` : ""}
      </p>
      {/* On the board as "A viewer": the form, open. Not on it yet: a link to it. */}
      {nameless && <BoardName folded={!board.my_rank} />}
    </section>
  );
}

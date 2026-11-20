"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import OutOfDates, { type OutOfDatesData } from "@/app/OutOfDates";
import Sheet from "@/app/Sheet";

/**
 * The one step before a date is spent (2026-10-31 UX audit, B5 and C2): every Send and Book opens this sheet, which says
 * who meets whom, what it uses ("1 of your 3 dates left", read fresh from /api/me), holds the date's optional settings
 * and has the one button that spends it. A failed send (none left, a closed character) stays in the sheet, with the shop
 * when it's about dates.
 */
export default function DateConfirm({
  open,
  onClose,
  title,
  lede,
  sendLabel,
  busyLabel = "Sending…",
  onSend,
  busy,
  disabled = false,
  error,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Who meets whom, in a sentence. */
  lede: ReactNode;
  sendLabel: string;
  busyLabel?: string;
  onSend: () => void;
  busy: boolean;
  /** The settings aren't ready yet (a roleplay half picked). */
  disabled?: boolean;
  /**
   * `link`: where the refusal points (a date still being filmed: "Watch it"). `wall`: the out-of-dates refusal's offer
   * (app/OutOfDates.tsx), shown in place of the text; `first` is the character's first name for its copy.
   */
  error?: { text: string; shop?: boolean; link?: { href: string; label: string }; wall?: OutOfDatesData | null; first?: string } | null;
  /** The date's optional settings, folded where there are several. */
  children?: ReactNode;
}) {
  const left = useDatesLeft(open);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p>{lede}</p>
      {children}
      <p className="muted small date-confirm-cost">
        {left === null ? "Uses 1 date." : left > 0 ? `Uses 1 of your ${left === 1 ? "1 date" : `${left} dates`} left.` : "You have no dates left this week."}
        {left !== null && left <= 0 && (
          <>
            {" "}
            <Link href="/shop">Get more</Link>
          </>
        )}
      </p>
      {error?.wall && <OutOfDates data={error.wall} first={error.first ?? "them"} />}
      {error && !error.wall && (
        <p className="sheet-error" role="alert">
          {error.text}
          {error.link && (
            <>
              {" "}
              <Link href={error.link.href}>{error.link.label}</Link>
            </>
          )}
          {error.shop && (
            <>
              {" "}
              <Link href="/shop">Get more dates</Link>
            </>
          )}
        </p>
      )}
      {/* Pinned to the sheet's foot (2026-11-20 mobile audit, B7): with Date settings open the sheet scrolls, and Send stays
          in reach, any refusal just above it. */}
      <div className="sheet-actions sheet-actions-pinned">
        <button type="button" className="button-ghost" onClick={onClose} disabled={busy}>
          Not yet
        </button>
        {/* Not disabled at 0: the server decides (an admin's or a pass's dates don't run out), and says why if not. */}
        <button type="button" className="primary" onClick={onSend} disabled={busy || disabled}>
          {busy ? busyLabel : sendLabel}
        </button>
      </div>
    </Sheet>
  );
}

/** This viewer's dates left, read when the sheet opens (null until it's known, or when it can't be). */
function useDatesLeft(open: boolean): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (live && typeof me?.dates_left === "number") setLeft(me.dates_left);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);
  return left;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/app/Icon";
import EmptyState from "@/app/EmptyState";

/**
 * The inbox's clearing (the design system's Notifications screen, 2026-11-21: Clear all sat in ⚙ Settings behind a
 * browser confirm, and a row's Clear was a word in its grey line). Now Clear all is beside the heading and every row
 * has its ×. Both act at once and offer Undo for a few seconds; only then is anything deleted (DELETE
 * /api/notifications), so there's nothing to confirm. Leaving the page in those seconds clears it anyway: Undo is for
 * a slip, not a draft. Clear all takes only what had arrived when it was pressed, and only the filtered type.
 */

const UNDO_MS = 5000;

type Pending = { kind: "ids"; ids: string[] } | { kind: "all"; before: string; count: number };

type InboxState = {
  gone: (id: string) => boolean;
  allGone: boolean;
  dismiss: (id: string) => void;
  clearAll: () => void;
};

const InboxContext = createContext<InboxState | null>(null);

function sendClear(pending: Pending, type: string | null, keepalive = false): Promise<Response | null> {
  const body = pending.kind === "ids" ? { ids: pending.ids } : { all: true, before: pending.before, ...(type ? { type } : {}) };
  return fetch("/api/notifications", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  }).catch(() => null);
}

/** Holds what's been cleared on this screen and the Undo bar. `total` is how many the filter has across every page. */
export function InboxProvider({ ids, total, type, children }: { ids: string[]; total: number; type: string | null; children: ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [allDone, setAllDone] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  pendingRef.current = pending;

  // What a finished clear hid stays hidden only until the refreshed list arrives without it: a notification that came
  // in after Clear all was pressed (kept by `before`) must then show.
  const idsKey = ids.join(",");
  useEffect(() => {
    setDone(new Set());
    setAllDone(false);
  }, [idsKey]);

  const commit = useCallback(async () => {
    const p = pendingRef.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!p) return;
    pendingRef.current = null;
    setPending(null);
    const res = await sendClear(p, type);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    if (p.kind === "all") setAllDone(true);
    else setDone((prev) => new Set([...prev, ...p.ids]));
    router.refresh();
  }, [router, type]);

  const arm = useCallback(
    (next: Pending) => {
      if (timer.current) clearTimeout(timer.current);
      pendingRef.current = next;
      setPending(next);
      setFailed(false);
      timer.current = setTimeout(() => void commit(), UNDO_MS);
    },
    [commit],
  );

  // Leaving with an Undo still open (a link, the back button, closing the tab) clears what was cleared.
  useEffect(() => {
    const flush = () => {
      const p = pendingRef.current;
      if (!p) return;
      pendingRef.current = null;
      void sendClear(p, type, true);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      if (timer.current) clearTimeout(timer.current);
      flush();
    };
  }, [type]);

  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pendingRef.current = null;
    setPending(null);
  };

  const allGone = allDone || pending?.kind === "all";
  const gone = (id: string) => allGone || done.has(id) || (pending?.kind === "ids" && pending.ids.includes(id));
  const state: InboxState = {
    gone,
    allGone: allGone || (ids.length > 0 && ids.every(gone)),
    dismiss: (id) => {
      const cur = pendingRef.current;
      if (cur?.kind === "all") return;
      arm({ kind: "ids", ids: [...(cur?.kind === "ids" ? cur.ids : []), id] });
    },
    clearAll: () => arm({ kind: "all", before: new Date().toISOString(), count: total }),
  };

  const cleared = pending ? (pending.kind === "all" ? pending.count : pending.ids.length) : 0;
  return (
    <InboxContext.Provider value={state}>
      {children}
      {(pending || failed) && (
        <div className="undo-bar" role="status" aria-live="polite">
          {failed ? (
            <p>Couldn&apos;t clear them. Try again.</p>
          ) : (
            <>
              <p>{cleared === 1 ? "Notification cleared." : `${cleared} notifications cleared.`}</p>
              <button type="button" className="link-button undo-bar-undo" onClick={undo}>
                <Icon name="undo" /> Undo
              </button>
            </>
          )}
        </div>
      )}
    </InboxContext.Provider>
  );
}

function useInbox(): InboxState {
  const inbox = useContext(InboxContext);
  return inbox ?? { gone: () => false, allGone: false, dismiss: () => {}, clearAll: () => {} };
}

/** Clear all, beside the heading. On a filtered page it clears that type, and says so to a screen reader. */
export function ClearAllButton({ typeLabel }: { typeLabel: string | null }) {
  const { allGone, clearAll } = useInbox();
  if (allGone) return null;
  return (
    <button type="button" className="link-button notif-clear-all" onClick={clearAll} aria-label={typeLabel ? `Clear all ${typeLabel} notifications` : undefined}>
      Clear all
    </button>
  );
}

/** One notification, gone from the list the moment its × is pressed. */
export function InboxRow({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  const { gone } = useInbox();
  if (gone(id)) return null;
  return (
    <li className={className}>{children}</li>
  );
}

/** A row's ×: clears it, then hands focus to the next row's × (or the one before) so a keyboard can keep going. */
export function DismissButton({ id }: { id: string }) {
  const { dismiss } = useInbox();
  return (
    <button
      type="button"
      className="notif-x"
      aria-label="Clear this notification"
      onClick={(e) => {
        const row = e.currentTarget.closest("li");
        const next = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLButtonElement>(".notif-x");
        dismiss(id);
        next?.focus();
      }}
    >
      <Icon name="x" />
    </button>
  );
}

/** The list and its pager, or, once everything on it is cleared, the caught-up line in their place. */
export function InboxList({ children }: { children: ReactNode }) {
  const { allGone } = useInbox();
  if (allGone)
    return (
      <EmptyState emoji="🔔" title="You're all caught up" secondary={{ href: "/watch", label: "Watch tonight's dates" }}>
        New texts, matches and reveals land here.
      </EmptyState>
    );
  return <>{children}</>;
}

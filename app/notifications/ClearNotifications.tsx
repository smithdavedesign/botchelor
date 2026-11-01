"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Clears notifications (DELETE /api/notifications): one, when given its id, or all of them (from ⚙ Settings, which
 * onDone closes). Refreshes the page and the bell.
 */
export default function ClearNotifications({ id, onDone }: { id?: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  async function clear() {
    if (!id && !window.confirm("Clear all your notifications? This can't be undone.")) return;
    setBusy(true);
    setFailed(false);
    const res = await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { ids: [id] } : { all: true }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setFailed(true);
    router.refresh();
    onDone?.();
  }

  return (
    <>
      <button type="button" className={id ? "link-button small" : "button-ghost"} onClick={() => void clear()} disabled={busy} aria-label={id ? "Clear this notification" : undefined}>
        {busy ? "Clearing…" : id ? "Clear" : "Clear all notifications"}
      </button>
      {failed && (
        <span className="muted small" role="status">
          {" "}
          Couldn&apos;t clear. Try again.
        </span>
      )}
    </>
  );
}

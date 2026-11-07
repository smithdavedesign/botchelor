"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_EMOJI, NOTIFICATION_TYPE_LABELS, type NotificationType } from "@/lib/notification-types";

/**
 * ⚙ Settings → which types to hear about (lib/notification-mutes.ts). A muted type still lands here, already read: no
 * bell, no push, no email. Saved on each tap.
 */
export default function NotificationMutes({ initial }: { initial: NotificationType[] }) {
  const [muted, setMutedState] = useState<Set<NotificationType>>(new Set(initial));
  const [busy, setBusy] = useState<NotificationType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (type: NotificationType) => {
    const next = !muted.has(type);
    setBusy(type);
    setError(null);
    try {
      const res = await requestJson("/api/notifications/mutes", { type, muted: next });
      if (!res.ok) throw new Error(res.message);
      setMutedState(new Set(res.data.muted as NotificationType[]));
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="notif-setting">
      <h3>What to hear about</h3>
      <p className="muted small">A muted type still lands here, already read: no bell, no push, no email.</p>
      <ul className="notif-mutes">
        {NOTIFICATION_TYPES.map((t) => (
          <li key={t}>
            <label>
              <input type="checkbox" checked={!muted.has(t)} disabled={busy !== null} onChange={() => toggle(t)} />
              <span aria-hidden="true">{NOTIFICATION_TYPE_EMOJI[t]}</span> {NOTIFICATION_TYPE_LABELS[t]}
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

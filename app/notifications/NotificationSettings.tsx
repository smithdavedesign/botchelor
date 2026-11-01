"use client";

import { useState, type ReactNode } from "react";
import Sheet from "@/app/Sheet";
import ClearNotifications from "./ClearNotifications";

/**
 * The notifications page's ⚙ Settings (2026-10-31 UX audit: the browser switch, the email line and Clear all sat above
 * the list, so on a phone the first notification started ~400px down). They open in a modal, and the page is the list.
 */
export default function NotificationSettings({ canClear, children }: { canClear: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button-ghost notif-settings" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span aria-hidden="true">⚙</span> Settings
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Notification settings">
        {children}
        {canClear && (
          <p className="notif-clear-all">
            <ClearNotifications onDone={() => setOpen(false)} />
          </p>
        )}
      </Sheet>
    </>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import Sheet from "@/app/Sheet";

/**
 * The notifications page's Settings (2026-10-31 UX audit: the browser switch and the email line sat above the list, so
 * on a phone the first notification started ~400px down). They open in a modal, and the page is the list. Clear all
 * isn't in here any more: it sits beside the heading (app/notifications/Inbox.tsx, 2026-11-21).
 */
export default function NotificationSettings({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link-button notif-settings" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Settings
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Notification settings" fit>
        {children}
      </Sheet>
    </>
  );
}

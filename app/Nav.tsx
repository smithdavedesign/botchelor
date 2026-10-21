"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** The primary nav links (the token meter and the logo sit outside this list). */
const LINKS = [
  { href: "/create", label: "Create" },
  { href: "/swipe", label: "Swipe" },
  { href: "/matches", label: "Matches" },
  { href: "/watch", label: "Watch" },
  { href: "/characters", label: "Characters" },
  { href: "/account", label: "Account" },
] as const;

/**
 * The site nav: a token meter that's always visible, a hamburger that collapses the links on phones, and
 * the links themselves (a row on desktop, a drop-down panel on mobile). "Tokens" are this viewer's dates
 * left — one token sends a character on one date — so the meter doubles as the entry to top up (M4 packs).
 */
export default function Nav({ tokens, unread = 0, texts = 0, afterDark = false }: { tokens: number; unread?: number; texts?: number; afterDark?: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu whenever the route changes (a link was followed).
  useEffect(() => setOpen(false), [pathname]);
  // Close on Escape, so the keyboard can always dismiss the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    // The page behind an open menu stays put on a phone, instead of scrolling under it.
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = before;
    };
  }, [open]);

  const tone = tokens <= 0 ? " empty" : tokens <= 1 ? " low" : "";

  return (
    <nav className="nav" aria-label="Primary">
      {/* #539: the count is free dates this week plus topped-up tokens, so it says "dates left", not "tokens". */}
      <Link href="/shop" className={`token-pill${tone}`} title="Dates left: your free dates this week plus any tokens you've topped up. One sends a character on one date.">
        <span className="token-pip" aria-hidden="true">◈</span>
        <span className="token-count">{tokens}</span>
        <span className="token-word">{tokens === 1 ? "date left" : "dates left"}</span>
      </Link>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="nav-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="nav-toggle-bars" aria-hidden="true" data-open={open} />
        {unread + texts > 0 && !open && <span className="nav-dot" aria-label={`${unread + texts} unread`} />}
      </button>
      {/* A tap anywhere outside the open menu closes it. In <body>, not here: the header's backdrop-filter would
          clip a fixed layer to the header itself. */}
      {open &&
        createPortal(<button type="button" className="nav-backdrop" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} />, document.body)}
      <div id="nav-menu" className="nav-links" data-open={open}>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={pathname === l.href || pathname.startsWith(`${l.href}/`) ? "page" : undefined}>
            {l.label}
            {l.href === "/matches" && texts > 0 && (
              <span className="nav-count" aria-label={`${texts} unread texts`}>
                {texts > 99 ? "99+" : texts}
              </span>
            )}
          </Link>
        ))}
        {afterDark && (
          <Link href="/after-dark" className="nav-after-dark" aria-current={pathname.startsWith("/after-dark") ? "page" : undefined}>
            🌙 After Dark
          </Link>
        )}
        <Link href="/notifications" aria-current={pathname === "/notifications" ? "page" : undefined} className="nav-bell">
          <span aria-hidden="true">🔔</span>
          <span className="nav-bell-label">Notifications</span>
          {unread > 0 && (
            <span className="nav-count" aria-label={`${unread} unread`}>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>
      </div>
    </nav>
  );
}

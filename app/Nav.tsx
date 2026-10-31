"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { afterDarkHref } from "@/lib/after-dark-host";
import { openFeedback } from "@/lib/user-feedback-shared";

/**
 * The primary nav links (the token meter and the logo sit outside these lists). David, 2026-10-22: Create isn't a nav
 * item. Someone with no character yet gets the show (Watch, Characters, the Constellation) and one "Make your character"
 * button; Swipe and Matches can't do anything for them, so they appear once there's a character, and doing anything
 * that needs one (swipe, match, date) sends them to /create and back.
 */
const OWNER_LINKS = [
  { href: "/watch", label: "Watch" },
  { href: "/swipe", label: "Swipe" },
  { href: "/matches", label: "Matches" },
  { href: "/characters", label: "Characters" },
  { href: "/showcase", label: "Showcase" },
  { href: "/account", label: "Account" },
] as const;
const NEWCOMER_LINKS = [
  { href: "/watch", label: "Watch" },
  { href: "/characters", label: "Characters" },
  { href: "/graph", label: "Constellation" },
  { href: "/showcase", label: "Showcase" },
  { href: "/account", label: "Account" },
] as const;

/**
 * The site nav: a token meter that's always visible, a hamburger that collapses the links on phones, and
 * the links themselves (a row on desktop, a drop-down panel on mobile). "Tokens" are this viewer's dates
 * left — one token sends a character on one date — so the meter doubles as the entry to top up (M4 packs).
 */
/**
 * `personal`: the viewer has an identity, so `tokens` is their own count. Without one (a newcomer before their first
 * action, or an agent reading the page, whose dates live on its MCP identity) it's the weekly allowance, said as such.
 */
export default function Nav({
  tokens: initialTokens,
  meter = "dates",
  personal = true,
  unread = 0,
  texts = 0,
  afterDark = false,
  hasCharacter = true,
}: {
  tokens: number;
  /** "tokens" on After Dark's host: bought tokens only, which is all After Dark spends (#1005). */
  meter?: "dates" | "tokens";
  personal?: boolean;
  /** The viewer owns a character: the owner's nav. Without one, the newcomer's, with the create button. */
  hasCharacter?: boolean;
  unread?: number;
  texts?: number;
  afterDark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // #1005 (2026-10-30 prod loop: "the shop said 40 tokens, the header still said 43"): the count is read again when the
  // page comes back into view and every half minute on a page that spends, so a spend shows without a reload.
  const [tokens, setTokens] = useState(initialTokens);
  useEffect(() => setTokens(initialTokens), [initialTokens]);
  useEffect(() => {
    if (!personal) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/me", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((me) => {
          const n = me?.[meter === "tokens" ? "tokens_left" : "dates_left"];
          if (typeof n === "number") setTokens(n);
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const spends = meter === "tokens" || pathname.startsWith("/after-dark");
    const timer = spends ? window.setInterval(refresh, 30_000) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      if (timer) window.clearInterval(timer);
    };
  }, [personal, meter, pathname]);

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
      {personal && meter === "tokens" ? (
        <Link href="/shop" className={`token-pill${tone}`} title="Tokens left. The subscription includes the chapters, their pictures and a few clips a month; tokens pay for the extras (more clips, the video of the night). The show's free weekly dates aren't spent here.">
          <span className="token-pip" aria-hidden="true">◈</span>
          <span className="token-count">{tokens}</span>
          <span className="token-word">{tokens === 1 ? "token" : "tokens"}</span>
        </Link>
      ) : personal ? (
        <Link href="/shop" className={`token-pill${tone}`} title="Dates left: your free dates this week plus any tokens you've topped up. One sends a character on one date.">
          <span className="token-pip" aria-hidden="true">◈</span>
          <span className="token-count">{tokens}</span>
          <span className="token-word">{tokens === 1 ? "date left" : "dates left"}</span>
        </Link>
      ) : (
        <Link href="/shop" className="token-pill" title={`Everyone gets ${tokens} free dates a week; yours count down here once you start. One sends a character on one date.`}>
          <span className="token-pip" aria-hidden="true">◈</span>
          <span className="token-count">{tokens}</span>
          <span className="token-word">{tokens === 1 ? "free date" : "free dates"}</span>
        </Link>
      )}
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
        {!hasCharacter && (
          <Link href="/create" className="button nav-create" aria-current={pathname === "/create" ? "page" : undefined}>
            Make your character
          </Link>
        )}
        {(hasCharacter ? OWNER_LINKS : NEWCOMER_LINKS).map((l) => (
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
          <Link href={afterDarkHref("/after-dark")} className="nav-after-dark" aria-current={pathname.startsWith("/after-dark") ? "page" : undefined}>
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
        {/* On a phone the floating Feedback button sat on forms (UX audit 2026-10-23): it lives in the menu there. */}
        <button
          type="button"
          className="nav-feedback"
          onClick={() => {
            setOpen(false);
            openFeedback();
          }}
        >
          <span aria-hidden="true">💬</span> Give us feedback
        </button>
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/app/Icon";
import { afterDarkHref } from "@/lib/after-dark-host";
import { openFeedback } from "@/lib/user-feedback-shared";

/**
 * The primary nav links (the token meter and the logo sit outside these lists). David, 2026-10-22: Create isn't a nav
 * item; a newcomer gets one "Make your character" button, and doing anything that needs a character sends them to
 * /create and back. Five doors since the 2026-11-07 product review (David: "do 1-5"): Watch · Dating · Characters ·
 * Companions · Account. Dating is one door — /matches is the hub and /swipe one tap away (the deck's own topbar and
 * the Matches header cross-link them). The Constellation and the Showcase moved under Watch (app/ShowTabs.tsx), which
 * supersedes the 2026-11-01 "Constellation stays in the nav" call with David's sign-off on the review plan.
 */
type NavLink = { href: string; label: string; also?: readonly string[] };
const OWNER_LINKS: readonly NavLink[] = [
  { href: "/watch", label: "Watch" },
  { href: "/matches", label: "Dating", also: ["/swipe", "/messages"] },
  { href: "/characters", label: "Characters" },
  { href: "/account", label: "Account" },
];
const NEWCOMER_LINKS: readonly NavLink[] = [
  { href: "/watch", label: "Watch" },
  { href: "/characters", label: "Characters" },
  { href: "/account", label: "Account" },
];

const COMPANIONS_LINK: NavLink = { href: "/companion", label: "Companions" };
/** The links for this viewer: Companions (once open) after Dating, or after Characters for a newcomer. */
function navLinks(hasCharacter: boolean, companions: boolean): readonly NavLink[] {
  const base = hasCharacter ? OWNER_LINKS : NEWCOMER_LINKS;
  if (!companions) return base;
  const after = base.findIndex((l) => l.href === (hasCharacter ? "/matches" : "/characters"));
  return [...base.slice(0, after + 1), COMPANIONS_LINK, ...base.slice(after + 1)];
}

/** Whether this link is where the viewer is, counting its sibling routes (`also`: /swipe and /messages are Dating). */
const atLink = (l: NavLink, pathname: string): boolean =>
  [l.href, ...(l.also ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`));

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
  adHost = false,
  hasCharacter = true,
  companions = false,
  prefetchShow = true,
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
  /** On After Dark's own host: the door turns into "Back to the show", and there's no create button. */
  adHost?: boolean;
  /** Companions are open to everyone (lib/companion-shared.ts companionOpen): their link after Matches. */
  companions?: boolean;
  /** False on After Dark's own host: the show's links there only redirect, so they aren't prefetched (app/layout.tsx). */
  prefetchShow?: boolean;
}) {
  const pf = prefetchShow ? undefined : false;
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
      {/* The tools (docs/brand.md, Header): the After Dark door (a link to its host, never a toggle; "Back to the show"
          on that host), the meter, and the newcomer's one call to action. The links follow. */}
      <div className="nav-tools">
        {adHost ? (
          <Link prefetch={false} href="/" className="nav-ad-link nav-ad-link--back">
            <Icon name="chevronLeft" />
            <span>Back to the show</span>
          </Link>
        ) : (
          afterDark && (
            <Link href={afterDarkHref("/after-dark")} className="nav-ad-link" aria-current={pathname.startsWith("/after-dark") ? "page" : undefined}>
              <Icon name="moon" />
              <span>After Dark</span>
              <Icon name="arrowUpRight" className="nav-ad-link-out" />
            </Link>
          )
        )}
        {/* Two meters, two units: the show's dates are a clapper on an outline pill; After Dark's tokens are ◈ on a night
            pill. Never the same pill with a different word, so no page has to explain which is spent where. */}
        {/* #539: the count is free dates this week plus topped-up tokens, so it says "dates left", not "tokens". */}
        {personal && meter === "tokens" ? (
          // #1173: After Dark's own page says what a token buys and how to get more (the show's shop sells them as dates).
          <Link href="/after-dark/tokens" className={`token-pill token-pill--tokens${tone}`} title="Tokens left. The subscription includes the chapters, their pictures and a few clips a month; tokens pay for the extras (more clips, the video of the night). The show's free weekly dates aren't spent here.">
            <span className="token-pip" aria-hidden="true">◈</span>
            <span className="token-count">{tokens}</span>
            <span className="token-word">{tokens === 1 ? "token" : "tokens"}</span>
          </Link>
        ) : personal ? (
          <Link prefetch={pf} href="/shop" className={`token-pill token-pill--dates${tone}`} title="Dates left: your free dates this week plus any tokens you've topped up. One sends a character on one date.">
            <Icon name="clapper" className="token-pip" />
            <span className="token-count">{tokens}</span>
            <span className="token-word">{tokens === 1 ? "date left" : "dates left"}</span>
          </Link>
        ) : (
          <Link prefetch={pf} href="/shop" className="token-pill token-pill--dates" title={`Everyone gets ${tokens} free dates a week; yours count down here once you start. One sends a character on one date.`}>
            <Icon name="clapper" className="token-pip" />
            <span className="token-count">{tokens}</span>
            <span className="token-word">{tokens === 1 ? "free date" : "free dates"}</span>
          </Link>
        )}
        {/* The one call to action, in the bar above 900px: words, or an icon-only plus between 900 and 1180px. On a
            phone it's in the menu (nav-create below). */}
        {!hasCharacter && !adHost && (
          <>
            <Link prefetch={pf} href="/create" className="button nav-cta nav-cta-full" aria-current={pathname === "/create" ? "page" : undefined}>
              Make your character
            </Link>
            <Link prefetch={pf} href="/create" className="button nav-cta nav-cta-compact" aria-label="Make your character" aria-current={pathname === "/create" ? "page" : undefined}>
              <Icon name="plus" />
            </Link>
          </>
        )}
      </div>
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
          <Link prefetch={pf} href="/create" className="button nav-create" aria-current={pathname === "/create" ? "page" : undefined}>
            Make your character
          </Link>
        )}
        {navLinks(hasCharacter, companions).map((l) => (
          <Link prefetch={pf} key={l.href} href={l.href} aria-current={atLink(l, pathname) ? "page" : undefined}>
            {l.label}
            {l.href === "/matches" && texts > 0 && (
              <span className="nav-count" aria-label={`${texts} unread texts`}>
                {texts > 99 ? "99+" : texts}
              </span>
            )}
          </Link>
        ))}
        {/* A first visit has nothing to be told yet (the audit, 2026-11-11, 2.6): the bell waits for a viewer of their own. */}
        {(personal || unread > 0) && (
          <Link prefetch={pf} href="/notifications" aria-current={pathname === "/notifications" ? "page" : undefined} className="nav-bell">
            <Icon name="bell" className="nav-bell-icon" />
            <span className="nav-bell-label">Notifications</span>
            {unread > 0 && (
              <span className="nav-count" aria-label={`${unread} unread`}>
                {unread > 99 ? "99+" : unread}
              </span>
          )}
        </Link>
        )}
        {/* On a phone the floating Feedback button sat on forms (UX audit 2026-10-23): it lives in the menu there. */}
        <button
          type="button"
          className="nav-feedback"
          onClick={() => {
            setOpen(false);
            openFeedback();
          }}
        >
          <Icon name="chat" /> Give us feedback
        </button>
      </div>
    </nav>
  );
}

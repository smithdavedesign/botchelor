"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import CharacterPicker from "@/app/CharacterPicker";
import Icon from "@/app/Icon";
import IntentLink from "@/app/IntentLink";
import { SPENT_EVENT } from "@/app/spent";
import { afterDarkHref } from "@/lib/after-dark-host";
import { NO_AD_DOORS, studioDoorLabel, type AdDoors } from "@/lib/adult/door-links";
import { AD_SHOWCASE } from "@/lib/showcase-paths";
import type { PickerCharacter } from "@/lib/my-characters";
import { openFeedback } from "@/lib/user-feedback-shared";
import { okJson } from "@/lib/ok-json";

/**
 * The primary nav links (the token meter and the logo sit outside these lists). Three doors and the account, the same
 * for everyone (2026-11-15, lib/nav-chat.ts): Watch · Chat · Characters · Account. Chat (/chat) is every thread a
 * person has: the ones with them (what was "Companions") and their characters' own (what was "Dating": /matches, the
 * swipe deck, a thread), so it's current on all of those, and its count is unread texts of both kinds. Create isn't a
 * nav item (David, 2026-10-22): a newcomer gets one "Make your character" button. The show's other rooms are under
 * Watch (app/ShowTabs.tsx).
 */
export type NavLink = { href: string; label: string; also?: readonly string[] };
/** The show's own tabs (app/ShowTabs.tsx: Watch · House · Season · Shows) and a season's page: all the Watch door. */
export const SHOW_PAGES: readonly string[] = ["/house", "/reunion", "/shows", "/seasons"];
const LINKS: readonly NavLink[] = [
  { href: "/watch", label: "Watch", also: SHOW_PAGES },
  { href: "/chat", label: "Chat", also: ["/matches", "/swipe", "/messages", "/companion"] },
  // The Constellation is Characters as a map (2026-11-21, app/characters/ViewSwitch.tsx), so it's this door's.
  { href: "/characters", label: "Characters", also: ["/graph"] },
  // The fifth door (2026-11-16): the Gallery (/showcase, what everyone made) and My studio (/studio), one place to show and make.
  { href: "/studio", label: "Studio", also: ["/showcase", "/reels"] },
  { href: "/account", label: "Account" },
];

/**
 * The header before 2026-11-15 (NAV_CHAT=0): Watch · Dating · Characters · Account for someone with a character,
 * without Dating for a newcomer, and the companions' directory a sub-link under Characters in the phone menu.
 */
const OWNER_LINKS: readonly NavLink[] = [
  { href: "/watch", label: "Watch", also: SHOW_PAGES },
  { href: "/matches", label: "Dating", also: ["/swipe", "/messages"] },
  { href: "/characters", label: "Characters", also: ["/companion"] },
  { href: "/account", label: "Account" },
];
const NEWCOMER_LINKS: readonly NavLink[] = [
  { href: "/watch", label: "Watch", also: SHOW_PAGES },
  { href: "/characters", label: "Characters", also: ["/companion"] },
  { href: "/account", label: "Account" },
];

/**
 * After Dark's own host has its own doors (the design kit's After Dark header, 2026-11-12; David approved Watch and
 * Dating leaving it, "Back to the show" staying). Since 2026-11-15 (David: "shouldn't we have an easier way to get to the
 * studio? or the showcase page in after dark?", then "go build all three"): Scenes · Studio · Gallery · Showcase ·
 * Episodes then, Scenes · Studio · Gallery since 2026-11-18, Scenes · Characters · Studio · Gallery since 2026-11-20, and
 * the account as an icon after them (as the show's bell), lib/adult/doors.ts deciding the two that depend on the viewer.
 * What moved where:
 *  - Characters → Studio (/after-dark/studio: whose Studio, then who's in) on 2026-11-15, then its own door again on
 *    2026-11-20 (joi.com's teardown): everyone they can have a night with, a page each (/after-dark/characters). The
 *    Studio door says "Who's in" where the Studio isn't open to them, since then its page only holds the switches.
 *  - Shorts → Episodes (the same page, /after-dark/shorts): "Shorts" read as the viewer's own videos, which live in the
 *    Gallery.
 *  - Showcase → a room of the Gallery (2026-11-18, David: the door "takes you out of after dark"): the showcase's After
 *    Dark side is After Dark's own page now (/after-dark/showcase, lib/showcase-paths.ts), Yours | Showcase under
 *    Gallery (app/after-dark/GalleryTabs.tsx) for whoever may see that side.
 *  - Episodes → a section of Scenes (2026-11-18, David: "move the episodes tab into scenes as a section"): the hub shows
 *    the newest and /after-dark/shorts keeps all of them and the board, Scenes marked current there. Scenes · Studio · Gallery.
 *  - Account → the icon at the row's end (a labelled item in the phone menu); it still covers tokens and subscribing.
 */
export function adLinks(doors: AdDoors = NO_AD_DOORS): NavLink[] {
  return [
    { href: "/after-dark", label: "Scenes" },
    { href: "/after-dark/characters", label: "Characters" },
    { href: "/after-dark/studio", label: studioDoorLabel(doors) },
    { href: "/after-dark/gallery", label: "Gallery", also: [AD_SHOWCASE] },
  ];
}
/** After Dark's account (privacy, the writer, the subscription and tokens): the icon after the doors. */
export const AD_ACCOUNT: NavLink = { href: "/after-dark/account", label: "Account", also: ["/after-dark/tokens", "/after-dark/subscribe"] };
/** After Dark's pages that aren't Scenes' (a night, or the episodes): every other door's, and the account's. */
const AD_PAGES = ["/after-dark/studio", "/after-dark/characters", "/after-dark/gallery", AD_SHOWCASE, AD_ACCOUNT.href, ...(AD_ACCOUNT.also ?? [])];

/** The links for this viewer: After Dark's on its own host, else the show's (the same for everyone while `chat` is on). */
function navLinks(hasCharacter: boolean, adHost = false, chat = true, doors: AdDoors = NO_AD_DOORS): readonly NavLink[] {
  if (adHost) return adLinks(doors);
  // The Studio door opens on what's theirs: an owner's own Studio; for everyone else the Gallery, which is open to all
  // since 2026-11-16 (a visitor's door is never an empty room).
  if (chat) return hasCharacter ? LINKS : LINKS.map((l) => (l.href === "/studio" ? { ...l, href: "/showcase", also: ["/studio", "/reels"] } : l));
  return hasCharacter ? OWNER_LINKS : NEWCOMER_LINKS;
}

/**
 * Whether this link is where the viewer is, counting its sibling routes (`also`: /matches, /swipe, /messages and /companion are Chat). The
 * phone's tab bar (app/PhoneTabBar.tsx) marks its tabs by this same rule.
 */
export const atLink = (l: NavLink, pathname: string): boolean => {
  // After Dark's Scenes is its home and every night under it (/after-dark/<a>/<b>), not its other doors' pages.
  if (l.href === "/after-dark") return pathname === l.href || (pathname.startsWith("/after-dark/") && !AD_PAGES.some((h) => pathname === h || pathname.startsWith(`${h}/`)));
  return [l.href, ...(l.also ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`));
};

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
  prefetchShow = true,
  showHref = "/",
  companions = false,
  chat = true,
  adDoors = NO_AD_DOORS,
  characters = [],
  character = null,
}: {
  tokens: number;
  /**
   * "tokens" on After Dark's host: bought tokens only, which is all After Dark spends (#1005). "none" there for someone
   * After Dark isn't open to (its Subscribe page, a locked Short): nothing to spend, so no count (the 2026-11-11 review).
   */
  meter?: "dates" | "tokens" | "none";
  personal?: boolean;
  /** The viewer owns a character: the owner's nav. Without one, the newcomer's, with the create button. */
  hasCharacter?: boolean;
  unread?: number;
  /** Unread texts: on Chat, both kinds (lib/inbox.ts unreadChatTexts); on Dating (NAV_CHAT=0), the characters' own. */
  texts?: number;
  /** Watch · Chat · Characters · Account (lib/nav-chat.ts navChatOn, read by the layout); false is the header before it. */
  chat?: boolean;
  afterDark?: boolean;
  /** On After Dark's own host: the door turns into "Back to the show", and there's no create button. */
  adHost?: boolean;
  /** Companions are open (lib/companion-shared.ts companionOpen): with `chat` off, the phone menu lists the directory under Characters. */
  companions?: boolean;
  /** Where "Back to the show" goes (lib/site.ts showHome): the show's address on After Dark's host. */
  showHref?: string;
  /**
   * False on After Dark's own host: the show's links there only redirect, so they aren't prefetched (app/layout.tsx).
   * On the show they're prefetched on intent only (app/IntentLink.tsx): the header is on every page.
   */
  prefetchShow?: boolean;
  /** On After Dark's own host: whether the Studio is open to them and whether they may see the showcase's After Dark side (lib/adult/doors.ts). */
  adDoors?: AdDoors;
  /**
   * The viewer's own characters (lib/my-characters.ts): the face at the bar's end is the one they're working with,
   * and switches it everywhere (app/CharacterPicker.tsx). Not on After Dark's host, whose Studio picks its own.
   */
  characters?: PickerCharacter[];
  /** The one this browser remembers (lib/current-character.ts), for the first paint. */
  character?: string | null;
}) {
  const pf = prefetchShow ? undefined : false;
  // The show's doors prefetch on intent (a hovered or keyboard-focused link); After Dark's own, on its own host, as before.
  const Door = adHost ? Link : IntentLink;
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // #1005 (2026-10-30 prod loop: "the shop said 40 tokens, the header still said 43"): the count is read again when the
  // page comes back into view and every half minute on a page that spends, so a spend shows without a reload. After
  // Dark's count is its own route's (app/api/after-dark/tokens): the balance as After Dark may spend it, never the show's.
  const [tokens, setTokens] = useState(initialTokens);
  useEffect(() => setTokens(initialTokens), [initialTokens]);
  useEffect(() => {
    if (!personal || meter === "none") return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      fetch(meter === "tokens" ? "/api/after-dark/tokens" : "/api/me", { cache: "no-store" })
        .then(okJson)
        .then((me) => {
          const n = me?.[meter === "tokens" ? "tokens_left" : "dates_left"];
          if (typeof n === "number") setTokens(n);
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    // A date just booked on this page (app/spent.ts): the count follows at once.
    window.addEventListener(SPENT_EVENT, refresh);
    const spends = meter === "tokens" || pathname.startsWith("/after-dark");
    const timer = spends ? window.setInterval(refresh, 30_000) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(SPENT_EVENT, refresh);
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
          // Named for a screen reader: on a phone the words are hidden and only the arrow shows.
          <Link prefetch={false} href={showHref} className="nav-ad-link nav-ad-link--back" aria-label="Back to the show">
            <Icon name="chevronLeft" />
            <span>Back to the show</span>
          </Link>
        ) : (
          afterDark && (
            <Link href={afterDarkHref("/after-dark")} className="nav-ad-link" aria-label="After Dark" aria-current={pathname.startsWith("/after-dark") ? "page" : undefined}>
              <Icon name="moon" />
              <span>After Dark</span>
              <Icon name="arrowUpRight" className="nav-ad-link-out" />
            </Link>
          )
        )}
        {/* Two meters, two units: the show's dates are a clapper on an outline pill; After Dark's tokens are ◈ on a night
            pill. Never the same pill with a different word, so no page has to explain which is spent where. */}
        {/* #539: the count is free dates this week plus topped-up tokens, so it says "dates left", not "tokens". */}
        {meter === "none" ? null : personal && meter === "tokens" ? (
          // #1173: After Dark's own page says what a token buys and how to get more (the show's shop sells them as dates).
          <Link href="/after-dark/tokens" className={`token-pill token-pill--tokens${tone}`} title="Tokens left for After Dark's extras (clips, the video of the night). Your pass covers the chapters and their pictures. Tap for what a token buys and where yours come from.">
            <span className="token-pip" aria-hidden="true">◈</span>
            <span className="token-count">{tokens}</span>
            <span className="token-word">{tokens === 1 ? "token" : "tokens"}</span>
          </Link>
        ) : personal ? (
          <IntentLink prefetch={pf} href="/shop" className={`token-pill token-pill--dates${tone}`} title="Dates left: your free dates this week plus any tokens you've topped up. One sends a character on one date.">
            <Icon name="clapper" className="token-pip" />
            <span className="token-count">{tokens}</span>
            <span className="token-word">{tokens === 1 ? "date left" : "dates left"}</span>
          </IntentLink>
        ) : (
          <IntentLink prefetch={pf} href="/shop" className="token-pill token-pill--dates" title={`Everyone gets ${tokens} free dates a week; yours count down here once you start. One sends a character on one date.`}>
            <Icon name="clapper" className="token-pip" />
            <span className="token-count">{tokens}</span>
            <span className="token-word">{tokens === 1 ? "free date" : "free dates"}</span>
          </IntentLink>
        )}
        {/* The one call to action, in the bar above 900px: words, or an icon-only plus between 900 and 1180px. On a
            phone it's in the menu (nav-create below). */}
        {!hasCharacter && !adHost && (
          <>
            <IntentLink prefetch={pf} href="/create" className="button nav-cta nav-cta-full" aria-current={pathname === "/create" ? "page" : undefined}>
              Make your character
            </IntentLink>
            <IntentLink prefetch={pf} href="/create" className="button nav-cta nav-cta-compact" aria-label="Make your character" aria-current={pathname === "/create" ? "page" : undefined}>
              <Icon name="plus" />
            </IntentLink>
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
        {unread + texts > 0 && !open && !adHost && <span className="nav-dot" aria-label={`${unread + texts} unread`} />}
      </button>
      {/* A tap anywhere outside the open menu closes it. In <body>, not here: the header's backdrop-filter would
          clip a fixed layer to the header itself. */}
      {open &&
        createPortal(<button type="button" className="nav-backdrop" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} />, document.body)}
      <div id="nav-menu" className="nav-links" data-open={open}>
        {!hasCharacter && !adHost && (
          <IntentLink prefetch={pf} href="/create" className="button nav-create" aria-current={pathname === "/create" ? "page" : undefined}>
            Make your character
          </IntentLink>
        )}
        {navLinks(hasCharacter, adHost, chat, adDoors).map((l) => (
          <Fragment key={l.href}>
            {/* After Dark's own links are on its own host, so they prefetch; the show's there only hop back. */}
            <Door prefetch={adHost ? undefined : pf} href={l.href} aria-current={atLink(l, pathname) ? "page" : undefined}>
              {l.label}
              {l.href === (chat ? "/chat" : "/matches") && texts > 0 && (
                <span className="nav-count" aria-label={`${texts} unread texts`}>
                  {texts > 99 ? "99+" : texts}
                </span>
              )}
            </Door>
            {/* NAV_CHAT=0, phone menu only: the companions' directory under Characters (in the desktop bar it's a tab). */}
            {l.href === "/characters" && companions && !chat && !adHost && (
              <IntentLink prefetch={pf} href="/companion" className="nav-sub">
                Companions
              </IntentLink>
            )}
          </Fragment>
        ))}
        {/* After Dark's account, as the show's bell: an icon after the doors, "Account" in the phone menu. */}
        {adHost && personal && afterDark && (
          <Link href={AD_ACCOUNT.href} aria-current={atLink(AD_ACCOUNT, pathname) ? "page" : undefined} className="nav-bell nav-ad-account" title="Account: privacy, the subscription and tokens">
            <Icon name="user" className="nav-bell-icon" />
            <span className="nav-bell-label">Account</span>
          </Link>
        )}
        {/* A first visit has nothing to be told yet (the audit, 2026-11-11, 2.6): the bell waits for a viewer of their own. */}
        {/* The bell is the show's (its notifications are the show's page), so not on After Dark's own host. */}
        {(personal || unread > 0) && !adHost && (
          <IntentLink prefetch={pf} href="/notifications" aria-current={pathname === "/notifications" ? "page" : undefined} className="nav-bell">
            <Icon name="bell" className="nav-bell-icon" />
            <span className="nav-bell-label">Notifications</span>
            {unread > 0 && (
              <span className="nav-count" aria-label={`${unread} unread`}>
                {unread > 99 ? "99+" : unread}
              </span>
          )}
        </IntentLink>
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
      {/* Who they're working with: last in the bar on a wide screen, before the menu button on a phone (the newcomer's
          call to action holds this place for someone without a character, docs/brand.md Header). */}
      {!adHost && characters.length > 0 && <CharacterPicker characters={characters} initial={character} />}
    </nav>
  );
}

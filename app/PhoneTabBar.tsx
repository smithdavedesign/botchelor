"use client";

import { usePathname } from "next/navigation";
import Icon, { type IconName } from "@/app/Icon";
import IntentLink from "@/app/IntentLink";
import { atLink, SHOW_PAGES, type NavLink } from "@/app/Nav";

type Tab = NavLink & { icon: IconName };

/**
 * The phone's tab bar (the 2026-11-14 design audit: "on mobile everything hides behind a hamburger; a four-item bottom
 * bar would cut taps on the phone-first surfaces"): Watch · Chat · Characters · Studio · You, the header's own
 * doors (app/Nav.tsx; lib/nav-chat.ts). Chat is current on every thread list (/chat, /matches, /companion). The
 * hamburger keeps everything else.
 *
 * `chat: false` (NAV_CHAT=0) is the bar before 2026-11-15: Watch · Characters · Companions · You, Companions a tab only
 * while companions are open, Characters current on /companion otherwise.
 */
export function tabBarTabs(companions: boolean, chat = true, hasCharacter = true): readonly Tab[] {
  // The show's own tabs (app/ShowTabs.tsx: Watch · House · Season · Shows) and a season's page are all the Watch door.
  const watch: Tab = { href: "/watch", label: "Watch", icon: "tv", also: SHOW_PAGES };
  const you: Tab = { href: "/account", label: "You", icon: "user" };
  if (chat) {
    return [
      watch,
      { href: "/chat", label: "Chat", icon: "chat", also: ["/matches", "/swipe", "/messages", "/companion"] },
      // The Constellation (/graph) is Characters as a map (app/characters/ViewSwitch.tsx).
      { href: "/characters", label: "Characters", icon: "users", also: ["/graph"] },
      // The fifth (2026-11-16): the Gallery and My studio (app/studio/StudioTabs.tsx).
      // An owner's own Studio; for anyone else the Gallery (app/Nav.tsx navLinks: the same rule).
      hasCharacter ? { href: "/studio", label: "Studio", icon: "sparkles", also: ["/showcase", "/reels"] } : { href: "/showcase", label: "Studio", icon: "sparkles", also: ["/studio", "/reels"] },
      you,
    ];
  }
  const characters: Tab = { href: "/characters", label: "Characters", icon: "users", also: companions ? [] : ["/companion"] };
  const companion: Tab = { href: "/companion", label: "Companions", icon: "chat" };
  return companions ? [watch, characters, companion, you] : [watch, characters, you];
}

/**
 * Where it never shows, by address: the full-screen surfaces and the pages that aren't the show's. The watch room
 * (/watch/<id>, its own dock at the foot), the step-in stage, a companion chat (/companion/<id>, its composer at the
 * foot), the swipe deck and a message thread (the whole screen on a phone), the character builder (its Next bar at the
 * foot), the 18+ gate, After Dark, the admin pages and email links. The theater (an episode's ?play=1 replay included)
 * and the other full-screen views are classes, not addresses: app/ux/chrome.css hides the bar there, from the same list
 * the floating Feedback button uses (app/globals.css, "people's feedback").
 */
const HIDDEN = [
  /^\/gate\/?$/,
  /^\/(admin|after-dark)(\/|$)/,
  /^\/email\//,
  /^\/watch\/[^/]+/,
  /^\/step-in\/[^/]+/,
  /^\/companion\/(?!plan(\/|$))[^/]+\/?$/,
  /^\/swipe(\/|$)/,
  /^\/messages\/[^/]+\/[^/]+/,
  /^\/create(\/|$)/,
];

export function tabBarShowsOn(path: string): boolean {
  return !HIDDEN.some((re) => re.test(path));
}

/**
 * Phones only (app/ux/chrome.css shows it up to 720px). The outer element stays in the page's flow at the bar's height,
 * so the foot of every page scrolls clear of it, and wherever the bar is hidden that room goes with it. Its tabs are
 * prefetched on intent only (app/IntentLink.tsx), which on a phone means never: the bar is on screen on every page.
 */
export default function PhoneTabBar({ companions = false, chat = true, unread = 0, hasCharacter = true }: { companions?: boolean; chat?: boolean; /** Unread texts of both kinds: a dot on Chat. */ unread?: number; /** The viewer has a character: Studio opens on their own. */ hasCharacter?: boolean }) {
  const pathname = usePathname() ?? "/";
  if (!tabBarShowsOn(pathname)) return null;
  return (
    <div className="tabbar">
      <nav className="tabbar-nav" aria-label="Sections">
        {tabBarTabs(companions, chat, hasCharacter).map((t) => {
          const here = atLink(t, pathname);
          return (
            <IntentLink key={t.href} href={t.href} className="tabbar-tab" aria-current={here ? "page" : undefined}>
              <span className="tabbar-icon-wrap">
                <Icon name={t.icon} className="tabbar-icon" />
                {t.href === "/chat" && unread > 0 && <span className="tabbar-dot" aria-label={`${unread} unread`} />}
              </span>
              <span className="tabbar-label">{t.label}</span>
            </IntentLink>
          );
        })}
      </nav>
    </div>
  );
}

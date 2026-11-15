"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon, { type IconName } from "@/app/Icon";
import { atLink, type NavLink } from "@/app/Nav";

type Tab = NavLink & { icon: IconName };

/**
 * The phone's tab bar (the 2026-11-14 design audit: "on mobile everything hides behind a hamburger; a four-item bottom
 * bar would cut taps on the phone-first surfaces"): Watch · Characters · Companions · You. Companions is a tab only
 * while companions are open (lib/companion-shared.ts companionOpen); otherwise it's three, and Characters stays current
 * on /companion, as it does in the header (app/Nav.tsx). The hamburger keeps everything else.
 */
export function tabBarTabs(companions: boolean): readonly Tab[] {
  const watch: Tab = { href: "/watch", label: "Watch", icon: "tv" };
  const characters: Tab = { href: "/characters", label: "Characters", icon: "users", also: companions ? [] : ["/companion"] };
  const companion: Tab = { href: "/companion", label: "Companions", icon: "chat" };
  const you: Tab = { href: "/account", label: "You", icon: "user" };
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
 * so the foot of every page scrolls clear of it, and wherever the bar is hidden that room goes with it.
 */
export default function PhoneTabBar({ companions = false }: { companions?: boolean }) {
  const pathname = usePathname() ?? "/";
  if (!tabBarShowsOn(pathname)) return null;
  return (
    <div className="tabbar">
      <nav className="tabbar-nav" aria-label="Sections">
        {tabBarTabs(companions).map((t) => {
          const here = atLink(t, pathname);
          return (
            <Link key={t.href} href={t.href} className="tabbar-tab" aria-current={here ? "page" : undefined}>
              <Icon name={t.icon} className="tabbar-icon" />
              <span className="tabbar-label">{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

import Link from "next/link";
import { navChatOn } from "@/lib/nav-chat";

/**
 * The show's one address (the 2026-11-07 product review, "do 1-5" item 4): every spectator surface carries the same
 * strip, so the rooms of the show read as one place instead of separate destinations. The nav keeps a single Watch
 * door; this strip does the rest. Plain links, no JavaScript.
 *
 * Since 2026-11-15 (lib/nav-chat.ts) the house is a room: it is where the show's story is told every day and was in no
 * tab; Reviews (1 visitor in 30 days) and the Constellation (3, nobody scrolling) left the strip and stay reachable
 * from /everything and the pages that link them. Their pages still pass their own address as `active`: the
 * Constellation is the house's map, so House is current there; Reviews marks none.
 *
 * Since 2026-11-16 (David: "I would assume we have shows and seasons here") the rooms are Watch · House · Season, all
 * three about the season on air. Reels was a format, not a room of this season (3 visitors in 30 days from here): it
 * is a tab of Characters now (app/characters/CharactersTabs.tsx), beside the people who make them. "Reunion" read as
 * if the season were over on night 16; the tab says Season, and /reunion keeps its address.
 */
const TABS = [
  { href: "/watch", label: "Watch" },
  { href: "/house", label: "House" },
  { href: "/reunion", label: "Season" },
] as const;

/** The strip before 2026-11-15, with NAV_CHAT=0. */
const TABS_BEFORE = [
  { href: "/watch", label: "Watch" },
  { href: "/showcase", label: "Reels" },
  { href: "/reunion", label: "Reunion" },
  { href: "/reviews", label: "Reviews" },
  { href: "/graph", label: "Constellation" },
] as const;

export type ShowTab = (typeof TABS)[number]["href"] | (typeof TABS_BEFORE)[number]["href"];

/** The tab that reads as current for a page that isn't one itself. */
const STANDS_FOR: Partial<Record<ShowTab, ShowTab>> = { "/graph": "/house" };

export default function ShowTabs({ active }: { active: ShowTab }) {
  const chat = navChatOn();
  const tabs: readonly { href: ShowTab; label: string }[] = chat ? TABS : TABS_BEFORE;
  const here = tabs.some((t) => t.href === active) ? active : (STANDS_FOR[active] ?? null);
  return (
    <nav className="tabs show-tabs" aria-label="The show">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === here ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

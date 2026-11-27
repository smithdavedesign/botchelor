import IntentLink from "@/app/IntentLink";
import { navChatOn } from "@/lib/nav-chat";
import { showIdeasOn } from "@/lib/show-ideas-switch";
import { english, msg, type T } from "@/lib/i18n/translate";

/**
 * The show's one address (the 2026-11-07 product review, "do 1-5" item 4): every spectator surface carries the same
 * strip, so the rooms of the show read as one place instead of separate destinations. The nav keeps a single Watch
 * door; this strip does the rest. Plain links, no JavaScript.
 *
 * Since 2026-11-15 (lib/nav-chat.ts) the house is a room: it is where the show's story is told every day and was in no
 * tab; Reviews (1 visitor in 30 days) and the Constellation (3, nobody scrolling) left the strip and stay reachable
 * from /everything and the pages that link them. Reviews still wears it and marks none. The Constellation doesn't
 * since 2026-11-21: it's Characters as a map (app/characters/ViewSwitch.tsx), and the week's story map it carried is
 * the house's own now.
 *
 * Since 2026-11-16 (David: "I would assume we have shows and seasons here") the rooms are Watch · House · Season, all
 * three about the season on air. Reels was a format, not a room of this season (3 visitors in 30 days from here): it
 * lives behind the Studio door now (the Gallery's reels view, app/showcase/reels; app/studio/StudioTabs.tsx). "Reunion" read as
 * if the season were over on night 16; the tab says Season, and /reunion keeps its address.
 *
 * Shows is the fourth (2026-11-16, later the same day): the show on air and the ideas for what could come next
 * (lib/show-ideas.ts). It is there while SHOW_IDEAS is on; with it off the strip is the three rooms again.
 *
 * Prefetched on intent only (app/IntentLink.tsx): the strip is on every spectator page.
 */
const TABS = [
  { href: "/watch", label: msg("Watch") },
  { href: "/house", label: msg("House") },
  { href: "/reunion", label: msg("Season") },
] as const;
const SHOWS = { href: "/shows", label: msg("Shows") } as const;

/** The strip before 2026-11-15, with NAV_CHAT=0. */
const TABS_BEFORE = [
  { href: "/watch", label: msg("Watch") },
  { href: "/showcase", label: msg("Reels") },
  { href: "/reunion", label: msg("Reunion") },
  { href: "/reviews", label: msg("Reviews") },
  { href: "/graph", label: msg("Constellation") },
] as const;

export type ShowTab = (typeof TABS)[number]["href"] | (typeof TABS_BEFORE)[number]["href"] | typeof SHOWS.href;

/** `t`: the page's translator (lib/i18n/server.ts getT) where the page is translated; English without one. */
export default function ShowTabs({ active, t: tr = english }: { active: ShowTab; t?: T }) {
  const chat = navChatOn();
  const tabs: readonly { href: ShowTab; label: string }[] = [...(chat ? TABS : TABS_BEFORE), ...(showIdeasOn() ? [SHOWS] : [])];
  const here = tabs.some((t) => t.href === active) ? active : null;
  return (
    <nav className="tabs show-tabs" aria-label={tr("The show")}>
      {tabs.map((t) => (
        <IntentLink key={t.href} href={t.href} aria-current={t.href === here ? "page" : undefined}>
          {tr(t.label)}
        </IntentLink>
      ))}
    </nav>
  );
}

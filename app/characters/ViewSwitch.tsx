import Link from "next/link";
import { tabHref, type Tab } from "@/lib/origin";
import type { SkyGroup } from "@/lib/origin-group";

/** Where on Characters someone is: a tab, their own (Yours), or nowhere in particular (a search, everyone). */
export type CharactersSpot = Tab | "yours" | null;

/** Each tab's group on the sky (lib/origin-group.ts): the originals are drawn with the cast, as the tab's preview does. */
const GROUP_OF: Record<Tab, SkyGroup> = { people: "person", cast: "cast", originals: "cast", agents: "agent" };
/** And back: the sky's group to the tab its cards are on. */
const TAB_OF: Record<SkyGroup, CharactersSpot> = { person: "people", cast: "cast", agent: "agents", yours: "yours" };

/** The Map's address for a spot on Characters: the Constellation opened on that tab's group (everyone for a search). */
export const mapHref = (spot: CharactersSpot): string => {
  const group = spot === null ? null : spot === "yours" ? "yours" : GROUP_OF[spot];
  return group ? `/graph?origin=${group}` : "/graph";
};

/** A spot's own address on Characters (the hub, which opens on the cast, for none). */
const spotHref = (spot: CharactersSpot): string => (spot === "yours" ? "/characters?tab=yours" : spot ? tabHref(spot) : "/characters");

/** The Cards' address for a group on the sky: that group's tab (the hub for everyone). */
export const cardsHref = (group: SkyGroup | null): string => spotHref(group ? TAB_OF[group] : null);

/**
 * Characters as cards or as a map (2026-11-21, David: the graph "seems worthy of its own page besides hidden behind
 * characters page"): the same people two ways. Cards is the hub (/characters); Map is the Constellation (/graph), opened
 * on the group the cards were showing, so the switch keeps your place both ways. Plain links: crawlable, no script.
 */
export default function ViewSwitch({ current, spot = null, group = null }: { current: "cards" | "map"; /** On Characters: the tab showing. */ spot?: CharactersSpot; /** On the map: the group it opened on. */ group?: SkyGroup | null }) {
  // Each link keeps the place: on the cards, Cards is this tab and Map its group; on the map, the reverse.
  const cards = current === "cards" ? spotHref(spot) : cardsHref(group);
  const map = current === "map" ? (group ? `/graph?origin=${group}` : "/graph") : mapHref(spot);
  return (
    <nav className="segmented view-switch" aria-label="Show characters as">
      <Link href={cards} className="segmented-tab" aria-current={current === "cards" ? "page" : undefined} data-track="characters-view-cards">
        Cards
      </Link>
      <Link href={map} className="segmented-tab" aria-current={current === "map" ? "page" : undefined} data-track="characters-view-map">
        Map
      </Link>
    </nav>
  );
}

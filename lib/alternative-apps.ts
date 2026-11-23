/**
 * The apps the /alternatives pages list (David's call, 2026-11-23): searches for "<app> alternatives" land on dated
 * lists of several apps, so each page lists the apps people use instead of the one it's about, Botchelor among them.
 * Narrow on purpose:
 * - Every fact comes from that app's own site (one of its `domains`), with a link to the page that says it, and the
 *   date it was read (ALTERNATIVE_APPS_CHECKED). A record holds only what was confirmed there: never "not stated", never
 *   a guess.
 * - No logos, marks or pictures of other apps, no ratings, scores or stars, no "best", nothing better or worse, no
 *   verdicts and no ranking. The list is alphabetical and says so. A name only says which app is meant.
 * - Botchelor's own entry is built from the code's numbers (lib/rules.ts, lib/companion-shared.ts, lib/catalog.ts), so it
 *   can't drift from what /pricing says and what we charge.
 *
 * ALTERNATIVES_LIST=0 takes the list off every page and puts back the words from before it (lib/alternatives.ts), in
 * case an app objects. Pure data and helpers: app/alternatives/AlternativeApps.tsx renders them.
 */
import { formatPrice, PACK_5 } from "./catalog";
import { COMPANION_FREE_PER_DAY } from "./companion-shared";
import { FREE_EPISODES_PER_SEASON } from "./rules";

type Env = Record<string, string | undefined>;

/** The day every other app's facts were read on its own site (a UTC date). */
export const ALTERNATIVE_APPS_CHECKED = "2026-11-23";
/** How long after that the list counts as fresh: the titles name the month until then, and drop it after. */
export const ALTERNATIVES_FRESH_DAYS = 45;
/** Fewer apps than this, Botchelor included, make no list: the page keeps the words from before the list. */
export const ALTERNATIVES_LIST_MIN = 3;

/** The kinds of fact a record can hold, in the order a block shows them, with their labels. "What it is" is `about`. */
export const FACT_LABELS = {
  free: "Free",
  paid: "Paid",
  adult: "Adult content",
  age: "Minimum age",
  platforms: "Runs on",
  cards: "Character cards",
} as const;
export type FactKind = keyof typeof FACT_LABELS;
const FACT_ORDER = Object.keys(FACT_LABELS) as FactKind[];

export type AppFact = {
  kind: FactKind;
  /** Short and neutral, in the app's own terms: what its page says, never a judgment of it. */
  value: string;
  /** The page on the app's own site that says it (on one of its `domains`); for this site, one of our own paths. */
  source: string;
};

export type AlternativeApp = {
  id: string;
  /** As the app writes it. */
  name: string;
  /** Its home page: the block's name links there. */
  home: string;
  /** The hosts that are its own site: a link on one of them, or on a subdomain of one, counts. */
  domains: readonly string[];
  /** What it is, in one plain line, as its own site puts it. */
  about: string;
  /** The page that says `about`, when it isn't `home`. */
  aboutSource?: string;
  facts: readonly AppFact[];
  /** Botchelor's own entry: its links are this site's own pages. */
  self?: boolean;
};

/**
 * Every other app, as its own site described it on ALTERNATIVE_APPS_CHECKED. Empty until each fact is checked against
 * the page it came from; the four apps with pages of their own (PAGE_APP_IDS) are among them.
 */
export const ALTERNATIVE_APPS: readonly AlternativeApp[] = [];

/** Each /alternatives page's slug (lib/alternatives.ts) and the app it's about, which its own list leaves out. */
export const PAGE_APP_IDS: Readonly<Record<string, string>> = {
  "character-ai": "character-ai",
  "janitor-ai": "janitor-ai",
  spicychat: "spicychat",
  chai: "chai",
};

/** The slug of the app's own /alternatives page, if it has one. */
export const pageForApp = (id: string): string | undefined => Object.keys(PAGE_APP_IDS).find((slug) => PAGE_APP_IDS[slug] === id);

/**
 * This site, from the code's own numbers. Its sources are the pages that say each thing: /pricing the free dates,
 * replies and prices, /import the PG rule and the cards, /terms the age, /accessibility the browsers. The PG show only.
 */
export function botchelorApp(): AlternativeApp {
  return {
    id: "botchelor",
    name: "Botchelor",
    home: "/",
    domains: [],
    about: "A blind-date show for original characters, written by AI: yours goes on dates, and can talk with you one to one as a Companion.",
    aboutSource: "/faq",
    facts: [
      { kind: "free", value: `${FREE_EPISODES_PER_SEASON} dates a week, and ${COMPANION_FREE_PER_DAY} Companion replies a day with a free account`, source: "/pricing" },
      { kind: "paid", value: `Optional, from ${formatPrice(PACK_5.price_cents)} (${PACK_5.episodes} more dates, paid once)`, source: "/pricing" },
      { kind: "adult", value: "The show is PG", source: "/import" },
      { kind: "age", value: "18", source: "/terms" },
      { kind: "platforms", value: "The browser, on phones and computers", source: "/accessibility" },
      { kind: "cards", value: "Imports TavernAI cards (V1, V2 or V3, JSON or PNG) and Character.AI creator fields", source: "/import" },
    ],
    self: true,
  };
}

const byName = (a: AlternativeApp, b: AlternativeApp) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/** A page's list: every app but the one the page is about, and Botchelor, in alphabetical order by name (case ignored). */
export function appsForAlternative(slug: string, apps: readonly AlternativeApp[] = ALTERNATIVE_APPS): AlternativeApp[] {
  const own = PAGE_APP_IDS[slug];
  return [...apps.filter((a) => a.id !== own && !a.self), botchelorApp()].sort(byName);
}

/** ALTERNATIVES_LIST=0 takes the lists off and brings the earlier titles, descriptions and heading back. On by default. */
export const alternativesListOn = (env: Env = process.env): boolean => env.ALTERNATIVES_LIST?.trim() !== "0";

/** What a page lists: null while the switch is off, or while there are too few apps to make a list. */
export function listedApps(slug: string, env: Env = process.env, apps: readonly AlternativeApp[] = ALTERNATIVE_APPS): AlternativeApp[] | null {
  if (!alternativesListOn(env)) return null;
  const list = appsForAlternative(slug, apps);
  return list.length >= ALTERNATIVES_LIST_MIN ? list : null;
}

const checkedAt = (checked: string) => new Date(`${checked}T00:00:00Z`);

/** Fresh for ALTERNATIVES_FRESH_DAYS after the facts were read; after that the titles stop naming the month. */
export function alternativesFresh(now: Date = new Date(), checked: string = ALTERNATIVE_APPS_CHECKED): boolean {
  return now.getTime() < checkedAt(checked).getTime() + ALTERNATIVES_FRESH_DAYS * 86_400_000;
}

/** "November 2026", for the titles. */
export const checkedMonth = (checked: string = ALTERNATIVE_APPS_CHECKED): string =>
  checkedAt(checked).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** "November 23, 2026", for the line under the list's heading. */
export const checkedDay = (checked: string = ALTERNATIVE_APPS_CHECKED): string =>
  checkedAt(checked).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Whether a link is on the app's own site: https on one of its domains or a subdomain of one; for this site, our path. */
export function onOwnSite(app: AlternativeApp, url: string): boolean {
  if (app.self) return url.startsWith("/") && !url.startsWith("//");
  try {
    const u = new URL(url);
    return u.protocol === "https:" && app.domains.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** A block's facts: only those whose source is the app's own site, in FACT_LABELS order. */
export function shownFacts(app: AlternativeApp): AppFact[] {
  return app.facts.filter((f) => onOwnSite(app, f.source)).sort((a, b) => FACT_ORDER.indexOf(a.kind) - FACT_ORDER.indexOf(b.kind));
}

/** The line under every list. */
export const NAMES_NOTE = "The names belong to their owners. Botchelor isn't affiliated with or endorsed by any of these apps.";

/** The list as schema.org data: in page order, positions from 1, each app's home (Botchelor's is the site). No ratings. */
export function appsItemList(name: string, apps: readonly AlternativeApp[], base: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: apps.length,
    itemListElement: apps.map((a, i) => ({ "@type": "ListItem", position: i + 1, name: a.name, url: a.self ? `${base}/` : a.home })),
  };
}

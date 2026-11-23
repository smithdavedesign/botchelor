/**
 * The apps the /alternatives pages list (David's call, 2026-11-23): searches for "<app> alternatives" land on dated
 * lists of several apps, so each page lists the apps people use instead of the one it's about, Botchelor among them.
 * Narrow on purpose:
 * - Every fact comes from that app's own site (one of its `domains`), with a link to the page that says it (two, when it
 *   takes two), and the date it was read (ALTERNATIVE_APPS_CHECKED). The values are the checked words; a record holds
 *   only what was confirmed there: never "not stated", never a guess. A fact that may soon be out of date (a sale) has
 *   an `until` day and hides itself from then on, until someone checks it again.
 * - No logos, marks or pictures of other apps, no ratings, scores or stars, no "best", nothing better or worse, no
 *   verdicts and no ranking. The list is alphabetical and says so. A name only says which app is meant.
 * - Botchelor's own entry is built from the code's numbers (lib/rules.ts, lib/companion-shared.ts, lib/catalog.ts), so it
 *   can't drift from what /pricing says and what we charge.
 *
 * ALTERNATIVES_LIST=0 takes the list (and the Character.AI page's note) off every page and puts back the words from
 * before it (lib/alternatives.ts), in case an app objects. Pure data and helpers: app/alternatives/AlternativeApps.tsx
 * and app/alternatives/AlternativeNote.tsx render them.
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
  status: "Status",
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
  /** A second page on its own site, when the value rests on two. */
  also?: string;
  /** A UTC day from which the fact hides, for one that may be out of date by then: it comes back once re-checked. */
  until?: string;
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
 * Every other app, as its own site described it on ALTERNATIVE_APPS_CHECKED: each value checked against the page it
 * links, word for word, and every link opened (2026-11-23). A kind an app's site didn't confirm is left out on purpose.
 * The four apps with pages of their own (PAGE_APP_IDS) are among them. Re-check before the list goes stale
 * (ALTERNATIVES_FRESH_DAYS): open each source, change what changed, and move ALTERNATIVE_APPS_CHECKED.
 */
export const ALTERNATIVE_APPS: readonly AlternativeApp[] = [
  {
    id: "chai",
    name: "Chai",
    home: "https://www.chai-research.com",
    domains: ["chai-research.com", "www.chai-research.com"],
    about: "A social AI app for making, sharing and talking to AI characters.",
    aboutSource: "https://www.chai-research.com/company-facts/",
    facts: [
      { kind: "paid", value: "In some regions, using it requires a paid subscription.", source: "https://www.chai-research.com/company-facts/" },
      { kind: "adult", value: "Its models are designed to refuse sexually explicit content.", source: "https://www.chai-research.com/safety.html" },
      { kind: "age", value: "18+, checked with age-assurance technology.", source: "https://www.chai-research.com/safety.html" },
      { kind: "platforms", value: "iOS and Android apps.", source: "https://www.chai-research.com/company-facts/" },
    ],
  },
  {
    id: "character-ai",
    name: "Character.AI",
    home: "https://character.ai",
    domains: ["character.ai", "blog.character.ai", "support.character.ai", "policies.character.ai"],
    about: "An AI entertainment app for interacting with characters, stories and communities.",
    aboutSource: "https://blog.character.ai/the-next-chapter-of-entertainment-and-fandom/",
    facts: [
      { kind: "status", value: "In a court-supervised Chapter 11 sale since October 12, 2026. It says that if no bid lets the platform keep running, it will be wound down; the auction is set for December 1, 2026.", source: "https://blog.character.ai/an-update-on-character-ai/", also: "https://blog.character.ai/chapter-11-update-and-transaction-notice/", until: "2026-12-05" },
      { kind: "free", value: "A free plan with unlimited messaging.", source: "https://blog.character.ai/new-styles-new-plan/" },
      { kind: "paid", value: "(c.ai) lite at $4.99 a month or $2.49 a week, varying by region; (c.ai+) at $94.99 a year on its subscribe page.", source: "https://blog.character.ai/new-styles-new-plan/", also: "https://character.ai/subscribe" },
      { kind: "age", value: "No open-ended chat with characters for users under 18.", source: "https://blog.character.ai/continuing-to-build-upon-our-safety-priorities/" },
      { kind: "platforms", value: "Website and app.", source: "https://blog.character.ai/an-update-on-character-ai/" },
    ],
  },
  {
    id: "chub-ai",
    name: "Chub AI",
    home: "https://chub.ai",
    domains: ["chub.ai", "docs.chub.ai"],
    about: "A site for chatting with AI characters through language-model APIs.",
    aboutSource: "https://docs.chub.ai/docs/the-basics/getting-started",
    facts: [
      { kind: "free", value: "One-time trial credits, worth a few dozen messages, for new users.", source: "https://chub.ai/subscription" },
      { kind: "paid", value: "$20 a month, paid in crypto only.", source: "https://chub.ai/subscription" },
      { kind: "adult", value: "It says it doesn't restrict the kinds of characters or chats in any meaningful way; anything sexualizing someone under 18 is banned.", source: "https://docs.chub.ai/docs/the-basics/getting-started", also: "https://chub.ai/tos" },
      { kind: "age", value: "18+.", source: "https://chub.ai/tos" },
      { kind: "platforms", value: "Web.", source: "https://chub.ai/tos" },
    ],
  },
  {
    id: "janitor-ai",
    name: "JanitorAI",
    home: "https://janitorai.com",
    domains: ["janitorai.com", "help.janitorai.com"],
    about: "A site for chatting with AI character bots.",
    aboutSource: "https://help.janitorai.com/en/article/faq-subscription-janitorai-1o8ccf2/",
    facts: [
      { kind: "free", value: "Unlimited chats on its standard models, with a context limit of about 9k tokens.", source: "https://help.janitorai.com/en/article/faq-subscription-janitorai-1o8ccf2/" },
      { kind: "paid", value: "Janitor+ adds 5x more context and priority access.", source: "https://help.janitorai.com/en/article/faq-subscription-janitorai-1o8ccf2/" },
      { kind: "adult", value: "Allowed on bots tagged Limitless; in its mobile app, NSFW content is off by default.", source: "https://help.janitorai.com/en/article/faq-whats-the-difference-between-limited-and-limitless-b78orr/", also: "https://help.janitorai.com/en/article/faq-how-do-i-download-the-janitor-mobile-app-1b3en2c/" },
      { kind: "age", value: "18+, with a one-time age check in Australia, Brazil and the UK.", source: "https://help.janitorai.com/en/article/age-verification-for-australia-brazil-and-the-uk-t4opjk/" },
      { kind: "platforms", value: "Web, plus iOS and Android apps (in beta).", source: "https://help.janitorai.com/en/article/faq-how-do-i-download-the-janitor-mobile-app-1b3en2c/" },
    ],
  },
  {
    id: "kindroid",
    name: "Kindroid",
    home: "https://kindroid.ai",
    domains: ["kindroid.ai"],
    about: "An app for making your own AI friend, called a Kin.",
    aboutSource: "https://kindroid.ai/",
    facts: [
      { kind: "free", value: "A one-time preview of 50 messages (15 in some regions); after that, the account is read-only without a trial or subscription.", source: "https://kindroid.ai/v2/docs/subscriptions/" },
      { kind: "paid", value: "Prices are shown at checkout and depend on your country and platform.", source: "https://kindroid.ai/v2/docs/subscriptions/" },
      { kind: "adult", value: "Its guidelines welcome NSFW and erotic roleplay.", source: "https://kindroid.ai/v2/docs/moderation-guidelines/" },
      { kind: "age", value: "18+.", source: "https://kindroid.ai/v2/docs/age-verification/" },
      { kind: "platforms", value: "Web, iOS and Android.", source: "https://kindroid.ai/v2/docs/subscriptions/" },
    ],
  },
  {
    id: "nomi",
    name: "Nomi",
    home: "https://nomi.ai",
    domains: ["nomi.ai"],
    about: "An AI companion with memory, for friendship, romance or mentoring.",
    aboutSource: "https://nomi.ai/",
    facts: [
      { kind: "free", value: "Free accounts get daily messages and images; voice calls, more Nomis and unlimited messaging need a subscription.", source: "https://nomi.ai/ai-girlfriend/" },
      { kind: "paid", value: "Billed monthly, quarterly or yearly.", source: "https://nomi.ai/cancellation-policy/" },
      { kind: "age", value: "18+.", source: "https://nomi.ai/terms-of-service/" },
      { kind: "platforms", value: "Web, iOS and Android.", source: "https://nomi.ai/cancellation-policy/" },
    ],
  },
  {
    id: "replika",
    name: "Replika",
    home: "https://replika.com",
    domains: ["replika.com", "help.replika.com", "my.replika.com"],
    about: "An AI companion app: a friend you can text and call.",
    aboutSource: "https://replika.com/",
    facts: [
      { kind: "free", value: "Basic features are free, with usage limits it can change.", source: "https://replika.com/legal/terms/en" },
      { kind: "paid", value: "Prices are shown on its subscription and checkout screens.", source: "https://replika.com/legal/terms/en" },
      { kind: "age", value: "18+ (or the age of majority where you live, if higher).", source: "https://replika.com/legal/terms/en" },
      { kind: "platforms", value: "Web, iOS and Android.", source: "https://replika.com/legal/terms/en" },
    ],
  },
  {
    id: "sillytavern",
    name: "SillyTavern",
    home: "https://sillytavern.app",
    domains: ["sillytavern.app", "docs.sillytavern.app"],
    about: "An interface you install yourself, for chatting with text, image and voice AI models.",
    aboutSource: "https://docs.sillytavern.app/",
    facts: [
      { kind: "free", value: "Free and open source (AGPL-3.0); you connect your own AI model or API.", source: "https://docs.sillytavern.app/" },
      { kind: "platforms", value: "Installs on Windows, Mac, Linux, Android or Docker.", source: "https://docs.sillytavern.app/" },
      { kind: "cards", value: "Imports characters from a file or a URL, and exports them.", source: "https://docs.sillytavern.app/usage/characters/" },
    ],
  },
  {
    id: "spicychat",
    name: "SpicyChat",
    home: "https://spicychat.ai",
    domains: ["spicychat.ai", "docs.spicychat.ai"],
    about: "A site for chatting and roleplaying with AI characters.",
    aboutSource: "https://docs.spicychat.ai/welcome-to-spicychat.ai",
    facts: [
      { kind: "free", value: "Its core features are free.", source: "https://docs.spicychat.ai/welcome-to-spicychat.ai" },
      { kind: "paid", value: "Get A Taste $5.95, True Supporter $19.95 and I'm All In $29.95 a month; $60, $199.95 and $299.95 a year (prices since September 8, 2026).", source: "https://docs.spicychat.ai/september-2026-pricing-update-faq" },
      { kind: "adult", value: "Bots with explicit language or images must be marked NSFW.", source: "https://docs.spicychat.ai/community-guidelines" },
      { kind: "age", value: "18+.", source: "https://docs.spicychat.ai/community-guidelines" },
      { kind: "platforms", value: "Web, and an Android app downloaded from its site; no iOS app (the site can be added to the home screen).", source: "https://docs.spicychat.ai/advanced/mobile-apps" },
      { kind: "cards", value: "Imports PNG character cards and JSON character files.", source: "https://docs.spicychat.ai/advanced/importing-characters" },
    ],
  },
  {
    id: "talkie",
    name: "Talkie",
    home: "https://www.talkie-ai.com",
    domains: ["talkie-ai.com", "www.talkie-ai.com"],
    about: "A website and app for chatting with interactive AI characters.",
    aboutSource: "https://www.talkie-ai.com/about",
    facts: [
      { kind: "free", value: "A free-of-charge \"Free Use\" program, which it may deny at its discretion.", source: "https://www.talkie-ai.com/static/service" },
      { kind: "paid", value: "Talkie+, a subscription with full access.", source: "https://www.talkie-ai.com/static/service" },
      { kind: "adult", value: "Not allowed, including suggestive content.", source: "https://www.talkie-ai.com/static/community-guideline" },
      { kind: "age", value: "14+, or higher where local law requires.", source: "https://www.talkie-ai.com/static/service" },
      { kind: "platforms", value: "Web, iOS and Android.", source: "https://www.talkie-ai.com/static/service" },
    ],
  },
];

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
      { kind: "free", value: `${FREE_EPISODES_PER_SEASON} dates a week, and ${COMPANION_FREE_PER_DAY} Companion replies a day with a free account.`, source: "/pricing" },
      { kind: "paid", value: `Optional, from ${formatPrice(PACK_5.price_cents)} (${PACK_5.episodes} more dates, paid once).`, source: "/pricing" },
      { kind: "adult", value: "The show is PG.", source: "/import" },
      { kind: "age", value: "18+.", source: "/terms" },
      { kind: "platforms", value: "The browser, on phones and computers.", source: "/accessibility" },
      { kind: "cards", value: "Imports TavernAI cards (V1, V2 or V3, JSON or PNG) and Character.AI creator fields.", source: "/import" },
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

/** Whether something with an `until` day (UTC) still shows at `now`: until the start of that day; with none, always. */
export const beforeUntil = (until: string | undefined, now: Date = new Date()): boolean => !until || now.getTime() < checkedAt(until).getTime();

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

/**
 * A block's facts at `now`, in FACT_LABELS order (a status first): only those whose sources are all the app's own site,
 * and none from its `until` day on. The pages render per request, so one hides itself with no deploy.
 */
export function shownFacts(app: AlternativeApp, now: Date = new Date()): AppFact[] {
  return app.facts
    .filter((f) => [f.source, ...(f.also === undefined ? [] : [f.also])].every((url) => onOwnSite(app, url)) && beforeUntil(f.until, now))
    .sort((a, b) => FACT_ORDER.indexOf(a.kind) - FACT_ORDER.indexOf(b.kind));
}

/** The line under every list. */
export const NAMES_NOTE = "The names belong to their owners. Botchelor isn't affiliated with or endorsed by any of these apps.";

/** A dated note one page shows under its hero, above the list, until its `until` day (UTC). */
export type AlternativeNote = {
  /** The /alternatives page it's on (lib/alternatives.ts). */
  slug: string;
  until: string;
  heading: string;
  /** Its paragraphs, word for word as checked. */
  body: readonly string[];
  /** Words in the last paragraph that link, quietly, to the page's own import door. */
  paste?: string;
  /** The app's own pages it quotes. */
  links: readonly { text: string; href: string }[];
};

/**
 * Character.AI's sale (2026-11-23): what its own announcements say, quoted and dated, with nothing added
 * (not why, not who might buy it, not what happens next). It hides from the day after the sale hearing, like the Status
 * fact above, until someone re-checks both. Never part of the FAQ or its structured data.
 */
export const characterAiNote: AlternativeNote = {
  slug: "character-ai",
  until: "2026-12-05",
  heading: "Is Character.AI shutting down?",
  body: [
    "As of November 23, 2026, its own site says the platform remains up and running.",
    "On October 12, 2026, Character.AI said it had started a voluntary Chapter 11 process for a court-supervised sale of the company. It said it hopes the sale lets the platform keep running, and that if no such bid comes, the platform will be wound down. Its sale notice sets an auction for December 1, 2026.",
    "It also says you can export your data through its app or website. If you want to keep a character you made there, copy its creator fields (Name, Tagline, Description, Greeting, Definition) and save them somewhere; you can paste them here too.",
  ],
  paste: "paste them here",
  links: [
    { text: "Its announcement (October 12, 2026)", href: "https://blog.character.ai/an-update-on-character-ai/" },
    { text: "Its sale notice (November 5, 2026)", href: "https://blog.character.ai/chapter-11-update-and-transaction-notice/" },
  ],
};

/** The note a page shows at `now`: the Character.AI page's, before its `until` and while the lists are on; else none. */
export function noteFor(slug: string, now: Date = new Date(), env: Env = process.env): AlternativeNote | null {
  const note = characterAiNote;
  return alternativesListOn(env) && slug === note.slug && beforeUntil(note.until, now) ? note : null;
}

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

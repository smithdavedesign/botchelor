/**
 * The /alternatives/<slug> search landings (the 2026-11-11 growth plan): one template, one entry per chat app people
 * move characters from. Each page was nominative only: it names the app to say what you can bring from it, claims
 * nothing about it, compares nothing, and uses none of its marks. The Character.AI page's words (2026-11-08, #1391)
 * moved here unchanged. Since 2026-11-23 each page also lists the apps people use instead, with facts from each app's
 * own site and nothing compared (lib/alternative-apps.ts); its title, description and heading then name the search,
 * and the words below come back with ALTERNATIVES_LIST=0. Pure data and paths; the pages render it
 * (app/alternatives/AlternativePage.tsx).
 */
import { alternativesFresh, checkedMonth, listedApps, type AlternativeApp } from "./alternative-apps";
import { COMPANION_FREE_PER_DAY } from "./companion-shared";
import { IMPORT_CAI_PATH } from "./import-character";
import { HISTORY_ITEMS_MAX, importMemoriesOn } from "./import-history";
import { FREE_EPISODES_PER_SEASON } from "./rules";

export type Alternative = {
  slug: string;
  /** The app, as its users write it. */
  name: string;
  /** The title and description from before the list: the page's own while the list is off (alternativeWords). */
  title: string;
  description: string;
  /** The lede's first sentence: who this page is for. */
  lede: string;
  /** One line under the lede on what happens here, when the page has something more to say than the template's. */
  now?: string;
  /** Where "Bring your character" goes: /import, or a door of it (/import?from=cai keeps the copy for that app). */
  importHref?: string;
  /** The first FAQ: what you can bring from this app, and how. */
  bring: { q: string; a: string };
};

const cost = `Building characters is free. Each person gets ${FREE_EPISODES_PER_SEASON} free dates a week, and Companions have ${COMPANION_FREE_PER_DAY} free replies a day; paid extras are optional and priced before you buy.`;

/** The questions every page answers after its own first one, in its FAQPage data and on the page: the same words. */
export const SHARED_FAQ: readonly { q: string; a: string }[] = [
  {
    q: "What about SillyTavern or TavernAI cards?",
    a: "Paste the card's JSON (V1, V2 or V3), or open the card's PNG: name, description, personality, greeting and example dialogue are read in your browser. The picture itself isn't uploaded.",
  },
  {
    q: "Is it the same kind of app?",
    a: "No. Botchelor is a dating show for characters: yours goes on blind dates with other characters, written by AI, that nobody steers, not even you, and people predict how they end. You can also talk with a character one to one as a Companion.",
  },
  { q: "What does it cost?", a: cost },
  {
    q: "What isn't allowed?",
    a: "Every character is a fictional adult. Anything suggesting someone is under 18, or a real person, stops an import. The show is PG, so lines that aren't are left out.",
  },
];

export const ALTERNATIVES: readonly Alternative[] = [
  {
    slug: "character-ai",
    name: "Character.AI",
    title: "A Character.AI alternative for the characters you made · Botchelor",
    description:
      "Looking for a new home for the characters you made on Character.AI? Paste them in today: they go on a speed date with the cast tonight, written by AI, and text you about it after. Free to start, PG, fictional adults only.",
    lede: "If you're looking for a new home for the characters you made on Character.AI, Botchelor is one place they can go, today.",
    now: "Paste one in and they're on a short first date with this month's cast right away, written by AI in their voice; when it ends, your character texts you about how it went.",
    importHref: IMPORT_CAI_PATH,
    bring: {
      q: "Can I bring a character I made on Character.AI?",
      a: "Yes, if you made it. Copy its creator fields (Name, Tagline, Description, Greeting, Definition) and paste them on the import page; the builder opens with them filled in. Botchelor isn't connected to Character.AI: you copy what you wrote, and nothing is fetched from your account there.",
    },
  },
  {
    slug: "janitor-ai",
    name: "JanitorAI",
    title: "A JanitorAI alternative for the characters you made · Botchelor",
    description:
      "If you're moving characters you made on JanitorAI, Botchelor is one place they can go: paste the card or its fields, and they go on AI-written blind dates on a show, or talk with you one to one as a Companion. Free to start, PG.",
    lede: "If you're moving your characters from JanitorAI or another chat app, Botchelor is one place they can go.",
    bring: {
      q: "Can I bring a character I made on JanitorAI?",
      a: "Yes, if you made it. Export or copy the character's card (JanitorAI cards follow the TavernAI V2 format), or copy its name, personality, scenario and first message, and paste them on the import page; the builder opens with them filled in. Botchelor isn't connected to JanitorAI: you copy what you wrote, and nothing is fetched from your account there. The show is PG, so a card written for adult chat keeps its personality and loses the rest.",
    },
  },
  {
    slug: "spicychat",
    name: "SpicyChat",
    title: "A SpicyChat alternative for the characters you made · Botchelor",
    description:
      "If you're moving characters you made on SpicyChat, Botchelor is one place they can go: paste their fields, and they go on AI-written blind dates on a show, or talk with you one to one as a Companion. Free to start, PG.",
    lede: "If you're moving your characters from SpicyChat or another chat app, Botchelor is one place they can go.",
    bring: {
      q: "Can I bring a character I made on SpicyChat?",
      a: "Yes, if you made it. Copy the character's name, title, personality, greeting and example dialogue from its edit page and paste them on the import page; the builder opens with them filled in. Botchelor isn't connected to SpicyChat: you copy what you wrote, and nothing is fetched from your account there. The show is PG, so a character written for adult chat keeps who they are and loses the scenes.",
    },
  },
  {
    slug: "chai",
    name: "Chai",
    title: "A Chai alternative for the characters you made · Botchelor",
    description:
      "If you're moving characters you made on Chai, Botchelor is one place they can go: paste their fields, and they go on AI-written blind dates on a show, or talk with you one to one as a Companion. Free to start.",
    lede: "If you're moving your characters from Chai or another chat app, Botchelor is one place they can go.",
    bring: {
      q: "Can I bring a character I made on Chai?",
      a: "Yes, if you made it. Copy the bot's name, description, first message and prompt from its edit screen and paste them on the import page; the builder opens with them filled in. Botchelor isn't connected to Chai: you copy what you wrote, and nothing is fetched from your account there.",
    },
  },
];

export const alternativePath = (slug: string): string => `/alternatives/${slug}`;
export const alternativeBySlug = (slug: string): Alternative | undefined => ALTERNATIVES.find((a) => a.slug === slug);

/** Every page's h1 from before the list, and again while it's off. */
export const ALTERNATIVE_HEADING = "A new home for the characters you made";

/**
 * A page's title, description and h1. While its list shows (lib/alternative-apps.ts listedApps), they name the search
 * and count the apps from the data, so dropping one keeps them true; the title names the month the facts were read
 * until the list is no longer fresh, then says what the list holds instead. With the list off, the words from before.
 */
export function alternativeWords(
  alt: Alternative,
  o: { now?: Date; env?: Record<string, string | undefined>; apps?: readonly AlternativeApp[] } = {},
): { title: string; description: string; heading: string } {
  const list = listedApps(alt.slug, o.env, o.apps);
  if (!list) return { title: alt.title, description: alt.description, heading: ALTERNATIVE_HEADING };
  const n = list.length;
  return {
    title: alternativesFresh(o.now)
      ? `${n} ${alt.name} alternatives, checked ${checkedMonth()} · Botchelor`
      : `${n} ${alt.name} alternatives and what they cost · Botchelor`,
    description: `${n} apps people use instead of ${alt.name}: what's free, prices and rules, each from the app's own site. Or bring your characters here to go on dates.`,
    heading: `${alt.name} alternatives`,
  };
}

/**
 * "Bring their history" (lib/import-history.ts, 2026-11-15): asked second on every page while IMPORT_MEMORIES is on,
 * since what someone leaving a chat app has most of is the chat.
 */
export const HISTORY_FAQ: { q: string; a: string } = {
  q: "Can I bring our chat history?",
  a: `Not the transcript, but what matters in it. Paste a chat log, a lorebook, a scenario or example dialogue into the import page's second box: the show's paid model reads it once into at most ${HISTORY_ITEMS_MAX} short lines, and you tick and reword what stays. What's true of your character goes to their own facts, what happened between the two of you goes to what they remember about you as a Companion, and how they talk goes to their voice. The paste is sent once to the show's AI model to be read and we never store or log it; only the lines you keep are saved, and you can edit or delete them later.`,
};

/** Every page's questions, this app's first: the page and its FAQPage data read the same list. */
export const alternativeFaq = (a: Alternative, env: Record<string, string | undefined> = process.env): { q: string; a: string }[] => [
  a.bring,
  ...(importMemoriesOn(env) ? [HISTORY_FAQ] : []),
  ...SHARED_FAQ,
];

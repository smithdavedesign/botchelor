/**
 * The /alternatives/<slug> search landings (the 2026-11-11 growth plan): one template, one entry per chat app people
 * move characters from. Each page is nominative only: it names the app to say what you can bring from it, claims
 * nothing about it, compares nothing, and uses none of its marks. The Character.AI page's words (2026-11-08, #1391)
 * moved here unchanged. Pure data and paths; the pages render it (app/alternatives/AlternativePage.tsx).
 */
import { COMPANION_FREE_PER_DAY } from "./companion-shared";
import { FREE_EPISODES_PER_SEASON } from "./rules";

export type Alternative = {
  slug: string;
  /** The app, as its users write it. */
  name: string;
  title: string;
  description: string;
  /** The lede's first sentence: who this page is for. */
  lede: string;
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
    title: "Moving your characters from Character.AI? · Botchelor",
    description:
      "If you're moving characters you made on Character.AI or another chat app, Botchelor is one place they can go: paste them in, and they go on AI-written blind dates on a show, or talk with you one to one as a Companion. Free to start.",
    lede: "If you're moving your characters from Character.AI, SillyTavern or another chat app, Botchelor is one place they can go.",
    bring: {
      q: "Can I bring a character I made on Character.AI?",
      a: "Yes, if you made it. Copy its creator fields (Name, Tagline, Description, Greeting, Definition) and paste them on the import page; the builder opens with them filled in. Botchelor isn't connected to Character.AI: you copy what you wrote, and nothing is fetched from your account there.",
    },
  },
  {
    slug: "janitor-ai",
    name: "JanitorAI",
    title: "Moving your characters from JanitorAI? · Botchelor",
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
    title: "Moving your characters from SpicyChat? · Botchelor",
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
    title: "Moving your characters from Chai? · Botchelor",
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
/** Every page's questions, this app's first: the page and its FAQPage data read the same list. */
export const alternativeFaq = (a: Alternative): { q: string; a: string }[] => [a.bring, ...SHARED_FAQ];

/**
 * The free tools for original characters (app/tools/*), in the order someone making a character reaches for them: a
 * whole random character, a name, where they are from, getting to know them, a ship name, a ship picked for you, the
 * story their romance follows, then whether the ship holds. One list for the hub (/tools), the line of other tools at the end of each tool's page and the ship pages
 * (app/tools/MoreTools.tsx), and /everything.
 *
 * The hub exists for search (2026-11-19): the tools are the pages that match what people type ("oc ship generator",
 * "shipping name", "oc chemistry test" in Search Console), and a page that gathers them, linked from every footer,
 * hands each one the site's links instead of two of them. Since 2026-11-23 the chemistry test is named for what people
 * search ("ship compatibility test", "love calculator"), at the same address.
 */
import { msg } from "./i18n/translate";
import { OC_NAMES_PATH } from "./oc-names";
import { PLACE_NAMES_PATH } from "./place-names";
import { OC_QUESTIONS, OC_QUESTIONS_PATH } from "./oc-questions";
import { TROPES, TROPES_PATH } from "./relationship-tropes";

/** lib/random-oc.ts RANDOM_OC_PATH, written out so the line of tools doesn't load the generator's lists (tests/random-oc.test.ts holds them equal). */
export const RANDOM_OC_TOOL_PATH = "/tools/random-oc-generator";

export const TOOLS_PATH = "/tools";
export const SHIP_TOOL_PATH = "/tools/ship-name-generator";
/** lib/chemistry-test.ts CHEMISTRY_TEST_PATH, written out so the line of tools doesn't load the date engine (tests/seo-crawl.test.ts holds them equal). */
export const CHEMISTRY_TOOL_PATH = "/tools/oc-chemistry-test";
/** lib/random-ship.ts RANDOM_SHIP_PATH, written out for the same reason (tests/random-ship-generator.test.ts holds them equal). */
export const RANDOM_SHIP_TOOL_PATH = "/tools/random-ship-generator";
/** Two names' quick compatibility reading: lib/chemistry-test.ts namesResultHref, written out for the same reason (a ship page links it). */
export const compatibilityHref = (a: string, b: string) => `${CHEMISTRY_TOOL_PATH}/result?${new URLSearchParams({ a_name: a, b_name: b })}`;

export type FreeTool = {
  path: string;
  /** As a heading or a link on its own. */
  name: string;
  /** In running text, after "the" ("More free tools: the ship name generator, …"). */
  inline: string;
  /** What it does, one sentence. */
  blurb: string;
};

export const FREE_TOOLS: readonly FreeTool[] = [
  {
    path: RANDOM_OC_TOOL_PATH,
    name: msg("Random OC generator"),
    inline: "random OC generator",
    blurb: "A whole original character in one click: a name, an age, who they are, three traits, what they want in love, a dealbreaker and a secret.",
  },
  {
    path: OC_NAMES_PATH,
    name: msg("OC name generator"),
    inline: "OC name generator",
    blurb: "Names for your original character, twelve at a time: fantasy, modern, sci-fi, gothic or cozy, feminine, masculine or neutral.",
  },
  {
    path: PLACE_NAMES_PATH,
    name: msg("Place name generator"),
    inline: "place name generator",
    blurb: "Names for the places in your story, twelve at a time: towns, wilds, realms and taverns, in the same five styles as the names.",
  },
  {
    path: OC_QUESTIONS_PATH,
    name: msg("Questions to ask your OC"),
    inline: "questions to ask your OC",
    blurb: `${OC_QUESTIONS.length} questions by theme, from what they drink in the morning to what they think love is, or one at a time at random.`,
  },
  {
    path: SHIP_TOOL_PATH,
    name: msg("Ship name generator"),
    inline: "ship name generator",
    blurb: "Two names in, their ship names out: the start of one blended into the end of the other, both ways round, best first.",
  },
  {
    path: RANDOM_SHIP_TOOL_PATH,
    name: msg("Random ship generator"),
    inline: "random ship generator",
    blurb: "One click pairs two characters, from the show's cast or the random OC generator, with their ship name and how well they'd get on.",
  },
  {
    path: TROPES_PATH,
    name: msg("Relationship trope generator"),
    inline: "relationship trope generator",
    blurb: `${TROPES.length} romance tropes for your ship, six at a time: sweet, slow burn, angsty, funny or flirty, each with a first scene your two characters can star in.`,
  },
  {
    path: CHEMISTRY_TOOL_PATH,
    name: msg("Ship compatibility test"),
    inline: "ship compatibility test",
    blurb: "A love calculator for ships: two names for a quick score, or three traits, a want and a dealbreaker each for their chemistry out of 100 and why.",
  },
];

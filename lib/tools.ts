/**
 * The free tools for original characters (app/tools/*), in the order someone making a character reaches for them: a
 * whole random character, a name, getting to know them, a ship name, then whether the ship holds. One list for the hub (/tools), the line of
 * other tools at the end of each tool's page and the ship pages (app/tools/MoreTools.tsx), and /everything.
 *
 * The hub exists for search (2026-11-19): the tools are the pages that match what people type ("oc ship generator",
 * "shipping name", "oc chemistry test" in Search Console), and a page that gathers them, linked from every footer,
 * hands each one the site's links instead of two of them.
 */
import { OC_NAMES_PATH } from "./oc-names";
import { OC_QUESTIONS, OC_QUESTIONS_PATH } from "./oc-questions";

/** lib/random-oc.ts RANDOM_OC_PATH, written out so the line of tools doesn't load the generator's lists (tests/random-oc.test.ts holds them equal). */
export const RANDOM_OC_TOOL_PATH = "/tools/random-oc-generator";

export const TOOLS_PATH = "/tools";
export const SHIP_TOOL_PATH = "/tools/ship-name-generator";
/** lib/chemistry-test.ts CHEMISTRY_TEST_PATH, written out so the line of tools doesn't load the date engine (tests/seo-crawl.test.ts holds them equal). */
export const CHEMISTRY_TOOL_PATH = "/tools/oc-chemistry-test";

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
    name: "Random OC generator",
    inline: "random OC generator",
    blurb: "A whole original character in one click: a name, an age, who they are, three traits, what they want in love, a dealbreaker and a secret.",
  },
  {
    path: OC_NAMES_PATH,
    name: "OC name generator",
    inline: "OC name generator",
    blurb: "Names for your original character, twelve at a time: fantasy, modern, sci-fi, gothic or cozy, feminine, masculine or neutral.",
  },
  {
    path: OC_QUESTIONS_PATH,
    name: "Questions to ask your OC",
    inline: "questions to ask your OC",
    blurb: `${OC_QUESTIONS.length} questions by theme, from what they drink in the morning to what they think love is, or one at a time at random.`,
  },
  {
    path: SHIP_TOOL_PATH,
    name: "Ship name generator",
    inline: "ship name generator",
    blurb: "Two names in, their ship names out: the start of one blended into the end of the other, both ways round, best first.",
  },
  {
    path: CHEMISTRY_TOOL_PATH,
    name: "OC chemistry test",
    inline: "OC chemistry test",
    blurb: "Three traits, a want and a dealbreaker each, and you get their chemistry out of 100 and how their first date ends.",
  },
];

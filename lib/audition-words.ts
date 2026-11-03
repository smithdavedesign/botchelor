/** What the audition panel says (lib/auditions.ts), apart from the server code so the panel can import it. */

/** Aired public dates a character needs before it can audition: something for voters to judge it by. */
export const AUDITION_MIN_DATES = 3;

/** Why a character can't audition, each with the words the owner sees. */
export const AUDITION_BLOCKS = {
  not_yours: "Only its owner can put a character up for the cast.",
  house: "House characters are cast by the show.",
  agent_made: "Only characters people make on the site can audition (not ones an agent made).",
  sign_in: "Sign in to an account first: the cast is for people's characters, and we need to reach you.",
  private: "Make it public first: the cast is on the show.",
  not_open: "Open it to dates first: the cast is who people can date by name.",
  pg: "Some of its sheet doesn't fit the show's PG rules yet: edit the parts marked on its page.",
  portrait: "It needs a portrait first.",
  dates: `It needs ${AUDITION_MIN_DATES} public dates first, so voters have something to judge.`,
  one_each: "You already have a character auditioning this month: one each.",
  rejected: "It was turned down for this season. Try again next month.",
} as const;
export type AuditionBlock = keyof typeof AUDITION_BLOCKS;

/**
 * Step into the date's client-safe half (lib/step-in.ts is the server's): the disclosure, the persona's limits and the
 * view the page plays. No server imports.
 */
import type { CharacterRef } from "./game";
import type { Ending } from "./rules";
import type { PlaceId } from "./venues";

/** The AI disclosure (SB 243 "clear and conspicuous"): said at the start, every DISCLOSURE_EVERY lines, and on return. */
export const disclosureText = (castName: string): string => `${castName.trim().split(/\s+/)[0] || castName} is an AI character on a show.`;
/** Lines between the in-thread reminders. */
export const DISCLOSURE_EVERY = 6;
/** Back after this long away (since the last line), the reminder shows again. */
export const DISCLOSURE_IDLE_MINUTES = 10;

export const PERSONA_PRONOUNS = ["she/her", "he/him", "they/them"] as const;
export const PERSONA_NAME_MAX = 30;
export const PERSONA_ABOUT_MAX = 160;
export type Persona = { name: string; pronouns: string; age: number; about: string };

export type StepInLine = { side: "a" | "b"; act: number; dialogue: string; action: string; emotion: string; walked_out?: true };

export type StepInView = {
  id: string;
  /** your_line: theirs to type; their_line: the cast member's to come (advance); finishing: the recap's being written; done. */
  state: "your_line" | "their_line" | "finishing" | "done";
  you: CharacterRef & { persona: boolean };
  them: CharacterRef;
  venue: PlaceId | null;
  act: string | null;
  lines: StepInLine[];
  /** The line number they're on, of how many. */
  line: number;
  of: number;
  /** Their last line as the date stands: they may say whether they'd see them again (private). */
  last_line: boolean;
  disclosure: { text: string; every: number; again: boolean };
  paused: boolean;
  format: string;
  visibility: string;
  /** Once it's done: how it ended (the reveal) and where it lives. */
  /** why: the producer's one line on how they played (lib/step-in-play.ts), when the cast member gave one. */
  /** family: which of the show's three endings; share_path: the signed link to send (lib/step-in-share.ts), null when the app can't sign. */
  ending?: { label: string; kind: string | null; best_line: string | null; why?: string | null; family: Ending; share_path: string | null };
  episode_path: string;
};

/** The ref on a shared verdict's link (lib/step-in-share.ts), so the engagement log tells these visits apart. */
export const STEP_IN_SHARE_REF = "stepin";

/** What a shared verdict says: `said` on the page that greets the reader, `card` on the picture and in the shared text. */
export const STEP_IN_SHARE_WORDS: Record<Ending, { said: string; card: (first: string) => string }> = {
  second_date: { said: "A second date.", card: (first) => `I got a second date with ${first}` },
  friends: { said: "Friends.", card: (first) => `${first} and I: friends.` },
  disaster: { said: "A disaster.", card: (first) => `My date with ${first}: a disaster.` },
};

/** The text a Share puts on the clipboard or in the phone's share sheet. */
export const stepInShareText = (castFirst: string, ending: Ending, url: string): string => `${STEP_IN_SHARE_WORDS[ending].card(castFirst)} on Botchelor. Your turn:\n${url}`;

/**
 * A person's "you" on a step-in date is a row in `characters` owned by `you:<their id>` (lib/step-in.ts personaOwner),
 * so the date engine can seat it. It is not a character anyone made: with step-in open to everyone there is one for
 * every visitor who plays, so it is never listed on /characters, counted as a character made, or allowed to take a
 * name (a guest called Sam must not stop anyone naming a character Sam).
 */
export const PERSONA_OWNER_PREFIX = "you:";
/** SQL that's true for every character but a "you" (`alias`: the characters table's alias, or none). */
export const notPersonaSql = (alias?: string): string => `coalesce(${alias ? `${alias}.` : ""}owner_id, '') not like '${PERSONA_OWNER_PREFIX}%'`;

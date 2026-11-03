/**
 * Step into the date's client-safe half (lib/step-in.ts is the server's): the disclosure, the persona's limits and the
 * view the page plays. No server imports.
 */
import type { CharacterRef } from "./game";
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
  ending?: { label: string; kind: string | null; best_line: string | null; why?: string | null };
  episode_path: string;
};

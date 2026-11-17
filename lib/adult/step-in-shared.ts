/**
 * What Step in's pages and its engine share (lib/adult/step-in.ts; docs/after-dark.md "Step in"): the scene as its page
 * shows it, and the few limits and words both sides say. Client-safe: no server imports.
 */
import type { PairLimits } from "./limits";

/** The viewer's line, at most this long (the PG companion's message is the same). */
export const STEP_IN_LINE_MAX = 1000;
/** The line under the title of every Step in page. */
export const STEP_IN_TAGLINE = "An AI character. Fiction between adults.";

/**
 * A place's name inside a sentence: its first letter lowered ("A corner café that closes in an hour" → "a corner café
 * that closes in an hour"). The catalog's names all start with a common word, never a proper noun.
 */
export const placeInSentence = (label: string): string => (label ? label.charAt(0).toLowerCase() + label.slice(1) : label);

export type StepInCharacter ={ id: string; name: string; portrait: string | null; hue: number | null };

export type StepInPlace = {
  /** The catalog's id (lib/adult/scene-catalog.ts); empty for a place the catalog no longer has. */
  id: string;
  title: string;
  /** The place as the scene keeps it and the prompt says it. */
  place: string;
  /** Its card's picture, and the full backdrop behind the scene; null paints the page's own gradient. */
  image: string | null;
  backdrop: string | null;
  /** Out in public (lib/adult/scenes.ts isPublicPlace): a kiss at most there. */
  public: boolean;
};

export type StepInMessageView = { id: string; role: "viewer" | "character" | "system"; kind: "aside" | "notice" | "place" | null; text: string; at: string };

export type StepInSceneView = {
  id: string;
  character: StepInCharacter;
  place: StepInPlace;
  /** The roleplay from the viewer's side: who plays whom, and how it starts with "you" in it (lib/scene-cards.ts cardForYou). */
  roleplay: { id: string; title: string; icon: string; you_play: string | null; they_play: string | null; setup: string } | null;
  /** The name the viewer goes by in scenes, when their persona is used; null: none, or one After Dark's lines left out. */
  persona: { name: string } | null;
  /** They have a persona, and the scene's checks leave it out (it plays without it). */
  persona_left_out: boolean;
  limits: PairLimits;
  /** The scene as it stands: a redrawn reply's earlier draws left out. */
  messages: StepInMessageView[];
  /** The newest reply's draws, when there's more than one: how many, and which is showing. */
  draws: { count: number; showing: number } | null;
  paused: boolean;
  /** Ended and filed: when, and its short recap. */
  ended: { at: string; recap: string | null } | null;
  can: { regenerate: boolean; carry_on: boolean; take_back: boolean };
  /** Scene steps left this month; null for an admin, who's never capped. */
  steps_left: number | null;
  started_at: string;
};

export type StepInSceneRef = {
  id: string;
  character: StepInCharacter;
  place: string;
  roleplay: string | null;
  last_at: string;
  ended_at: string | null;
  /** An ended scene's one line (what the next one with them remembers). */
  line: string | null;
};

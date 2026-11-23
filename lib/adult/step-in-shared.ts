/**
 * What Step in's pages and its engine share (lib/adult/step-in.ts; docs/after-dark.md "Step in"): the scene as its page
 * shows it, and the few limits and words both sides say. Client-safe: no server imports.
 */
import { storySpeech } from "../story-reply";
import type { PairLimits } from "./limits";

/** The viewer's line, at most this long (the PG companion's message is the same). */
export const STEP_IN_LINE_MAX = 1000;
/** The line under the title of every Step in page. */
export const STEP_IN_TAGLINE = "An AI character. Fiction between adults.";

/**
 * Something to say first (2026-11-22, from the field's teardown: the best-known sites put two tappable starters under a
 * character's greeting, because an empty box is where a new conversation stalls). Under a scene's opening, until the
 * viewer has written anything, in a scene with no roleplay (a roleplay's opening already says what's going on): a tap
 * puts the line in the box to send or change, never sends it. Plain, mild lines that fit any place, each held to every
 * check a typed line is (tests/after-dark-step-in-voice.test.ts).
 */
export const STEP_IN_STARTERS: readonly string[] = ["Hi. I've been looking forward to this.", "Tell me what you've been up to tonight.", "I look around, then at you. \"So this is where you hide.\""];

/** A piece of speech a voice says in one go: about a sentence or two, so the first words are heard soon. */
export const VOICE_PIECE_MAX = 220;
/** The most pieces of one reply that are voiced (a reply is two to four short paragraphs; a call line a few sentences). */
export const VOICE_PIECES_MAX = 8;

/**
 * What of a reply can be heard, as the pieces a voice says one after another (lib/adult/step-in-voice.ts): only what's
 * said out loud, the lines inside its double quotes (a line said on a call is kept as one quoted line, so all of it),
 * never the narration. A long line is cut at its sentences. The same on the server, which voices piece n of the stored
 * reply, and on the page, which asks for them in order.
 */
export function spokenPieces(text: string): string[] {
  const out: string[] = [];
  for (const line of storySpeech(text)) {
    let piece = "";
    for (const sentence of line.match(/[^.!?…]+(?:[.!?…]+["'’”)\]]*\s*|$)/g) ?? [line]) {
      const s = sentence.trim();
      if (!s) continue;
      if (piece && piece.length + 1 + s.length > VOICE_PIECE_MAX) {
        out.push(piece);
        piece = s;
      } else piece = piece ? `${piece} ${s}` : s;
    }
    if (piece) out.push(piece);
  }
  return out.slice(0, VOICE_PIECES_MAX);
}

/** A line said on a call, as the page's captions show it: without the quote marks it's kept in. */
export const callWords = (text: string): string => storySpeech(text).join(" ") || text.replace(/^["“]|["”]$/g, "").trim();

/**
 * A place's name inside a sentence: its first letter lowered ("A corner café that closes in an hour" → "a corner café
 * that closes in an hour"). The catalog's names all start with a common word, never a proper noun.
 */
export const placeInSentence = (label: string): string => (label ? label.charAt(0).toLowerCase() + label.slice(1) : label);

/** `house`: one of the show's own cast (set where the set-up's picker groups them, lib/adult/step-in.ts stepInCast). */
export type StepInCharacter = { id: string; name: string; portrait: string | null; hue: number | null; house?: boolean };

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

/**
 * `kind`: "call" is a line said out loud (the viewer's on a call, or the character's answer, which is all speech);
 * "call_aside" the character's spoken stand-in when a spoken reply couldn't be used. `spoken`: how many pieces of a
 * character's reply can be heard (spokenPieces), 0 when nothing in it is said out loud.
 */
export type StepInMessageView = { id: string; role: "viewer" | "character" | "system"; kind: "aside" | "notice" | "place" | "call" | "call_aside" | null; text: string; at: string; spoken?: number };

/** One thing a character remembers about the viewer (lib/adult/step-in-memory.ts). `yours`: the viewer wrote or changed it. */
export type StepInFact = { id: string; text: string; pinned: boolean; yours: boolean; at: string };

export type StepInSceneView = {
  id: string;
  character: StepInCharacter;
  /** They're no longer in the viewer's After Dark (switched out, left the cast, deleted): the scene is read-only. */
  character_out: boolean;
  place: StepInPlace;
  /** The roleplay from the viewer's side: who plays whom, and how it starts with "you" in it (lib/scene-cards.ts cardForYou). */
  roleplay: { id: string; title: string; icon: string; you_play: string | null; they_play: string | null; setup: string } | null;
  /** The name the viewer goes by in scenes, when their persona is used; null: none, or one After Dark's lines left out. */
  persona: { name: string } | null;
  /** They have a persona, and the scene's checks leave it out (it plays without it). */
  persona_left_out: boolean;
  limits: PairLimits;
  /**
   * The viewer's own opening line, when they wrote one (null for one of ours, which sets the scene and isn't a line
   * anyone said): shown as their first line, since the character's first reply answers it.
   */
  opening: string | null;
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
  /** The viewer's memory switch (off until they agree), and how many things this character remembers about them. */
  memory: { on: boolean; facts: number };
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

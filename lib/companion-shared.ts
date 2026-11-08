/**
 * Companions' client-safe half (lib/companion.ts is the server's): the shapes a thread page reads, the reply lengths,
 * the report reasons, the AI notice and the places a scene can be played at.
 */
import { VENUE_IDS, type VenueId } from "./venues";

/** COMPANION_OPEN=1 opens companions to every signed-in adult; unset (the default) keeps them to admins. */
export function companionOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.COMPANION_OPEN?.trim() === "1";
}

/**
 * Someone without an account can try a companion first (2026-11-07 audit, item 6: "Sign in to talk" came before a single
 * line): this many replies in all, then a free account keeps the conversation going, memory and all (an account adopts
 * the visitor's id, lib/auth.ts). COMPANION_GUEST_REPLIES overrides it; 0 turns guests off.
 */
export const COMPANION_GUEST_REPLIES = 5;
/** The conversations a guest may open (each starts with a free opener from the character). */
export const COMPANION_GUEST_THREADS = 3;

export function companionGuestReplies(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt((env.COMPANION_GUEST_REPLIES ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : COMPANION_GUEST_REPLIES;
}

/** Guests may talk once companions are open to everyone and guest replies aren't turned off. */
export function companionGuestsOpen(env: Record<string, string | undefined> = process.env): boolean {
  return companionOpen(env) && companionGuestReplies(env) > 0;
}

export const REPLY_LENGTHS = ["short", "normal", "long"] as const;
export type ReplyLength = (typeof REPLY_LENGTHS)[number];
export const REPLY_LENGTH_LABELS: Record<ReplyLength, string> = { short: "Short", normal: "Normal", long: "Long" };

/** The longest message a person can send. */
export const COMPANION_MESSAGE_MAX = 1000;
/** The free tier's replies a day across every companion, and the Companion Plan's fair use a month (lib/companion-plan.ts). */
export const COMPANION_FREE_PER_DAY = 30;
export const COMPANION_FAIR_USE_PER_MONTH = 3000;

export const COMPANION_REPORT_REASONS = ["sexual", "minor", "hateful", "self_harm", "out_of_character", "other"] as const;
export type CompanionReportReason = (typeof COMPANION_REPORT_REASONS)[number];
export const COMPANION_REPORT_LABELS: Record<CompanionReportReason, string> = {
  sexual: "Sexual or explicit",
  minor: "About someone under 18",
  hateful: "Hateful or cruel",
  self_harm: "About self-harm",
  out_of_character: "Broke character or made no sense",
  other: "Something else",
};

/**
 * The AI notice (California SB 243, New York GBL Art. 47): put in the thread when a conversation starts or picks up
 * again, and every three hours of talking. A line in the thread, not a pop-up.
 */
export const companionNotice = (name: string): string => `${name.trim().split(/\s+/)[0] || name} is an AI character, not a real person.`;

/**
 * Scenes: instead of texting, the two play a scene at one of the show's places, face to face (lib/companion.ts setScene).
 * Any of the date venues but the double date (a scene is the two of them); something they both imagine, never a real
 * meeting.
 */
export const SCENE_PLACES: readonly VenueId[] = VENUE_IDS.filter((id) => id !== "double_date");
export const isScenePlace = (v: unknown): v is VenueId => typeof v === "string" && (SCENE_PLACES as readonly string[]).includes(v);
/** What MCP's scene action takes to go back to texting, in place of a place. */
export const SCENE_TEXTING = "texting";

export type CompanionMessageView = {
  id: string;
  role: "user" | "character" | "system";
  text: string;
  at: string;
  reported: boolean;
  /** The scene it was said in (null: texted). */
  scene: VenueId | null;
  /** In a scene, what the character does as they say it. */
  action: string | null;
  /** A system line that starts a scene or goes back to texting (null: the AI notice). */
  marker: "scene" | "texting" | null;
};

export type CompanionCharacterRef = {
  id: string;
  name: string;
  portrait: string | null;
  hue: number | null;
  house: boolean;
  yours: boolean;
  /** For a voice that fits when their lines are read aloud (app/theater/useSpeech.ts). */
  pronouns?: "she/her" | "he/him" | "they/them" | null;
};

export type CompanionThreadView = {
  id: string;
  character: CompanionCharacterRef;
  messages: CompanionMessageView[];
  reply_length: ReplyLength;
  /** The scene they're playing now (null: texting). */
  scene: VenueId | null;
  /** The crisis resources are up: nothing more in character until the person carries on. */
  paused: boolean;
  /** How many things the character remembers about you (the memory page). */
  facts: number;
};

export type CompanionFactView = { id: string; kind: string; text: string; pinned: boolean; edited: boolean; at: string };

/* ------------------------------------------- companions over MCP (lib/companion-mcp.ts) ------------------------------------------- */

export const COMPANION_ACTIONS = ["list", "open", "send", "read", "regenerate", "edit", "length", "scene", "carry_on", "report", "memory", "remember", "forget", "forget_all", "delete"] as const;
export type CompanionAction = (typeof COMPANION_ACTIONS)[number];

/** One agent's messages (sends, regenerates and edits) an hour and a day: they're on the show's model. */
export const COMPANION_AGENT_LIMITS = { perHour: 60, perDay: 300 };
/** Every agent's together a day, so the show's spend on agents' companions has a ceiling (about $2 a day at $0.001). */
export const COMPANION_AGENTS_DAILY = { perHour: 500, perDay: 2000 };
export const COMPANION_TOOL_DESCRIPTION =
  "Talk one to one with a character, as yourself (a companion): the show's house cast, its open cast, or one of your own characters, never another agent's or person's. " +
  "Free; your messages run on the show's model, up to " + `${COMPANION_AGENT_LIMITS.perHour} an hour and ${COMPANION_AGENT_LIMITS.perDay} a day. ` +
  "The character is an AI character and says so (notice); it's PG like the show, and it remembers what you tell it (memory, yours to change). Nothing said here reaches a date, a text or the show. " +
  "action: list (who you can talk with, and your threads), open {character_id} (starts or finds your thread: its first messages), send {character_id or thread_id, text} (opens the thread if needed; returns reply, the character's new messages), " +
  "read {thread_id, limit}, regenerate (draw the last reply again), edit {text} (rewrite your last message), length {length: short|normal|long}, " +
  "scene {place} (play a scene together at one of the show's places, face to face: they answer with what they say and what they do; place texting goes back to texting), report {message_id, reason}, " +
  "memory (what it knows about you), remember {text}, forget {fact_id}, forget_all, carry_on (after crisis resources paused it), delete. Every action but list and open takes thread_id (or character_id).";


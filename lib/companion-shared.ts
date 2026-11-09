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

/**
 * Companions' extras (P3, docs/companions.md "Voice notes"): the Companion Plan includes `included` of each a calendar
 * month; past that, and without the plan, a bought token buys a bundle of `bundle`, kept as credits until they're used.
 * A token is the show's smallest unit ($0.80, about $0.72 after Stripe), so a bundle is how it comes out at about cost.
 * Guests (no account) get none of these.
 */
export const COMPANION_EXTRAS = {
  voice: { included: 30, bundle: 100, tokens: 1, one: "voice note", many: "voice notes" },
} as const;
export type CompanionExtraKind = keyof typeof COMPANION_EXTRAS;
export const COMPANION_EXTRA_KINDS = Object.keys(COMPANION_EXTRAS) as CompanionExtraKind[];

/** Where a person stands on one extra: what the plan still includes this month, their credits, and whether it's free. */
export type CompanionExtraState = {
  /** Admins: never counted. */
  free: boolean;
  /** Left of the plan's monthly ones (null without the plan). */
  included_left: number | null;
  /** Bought ones left. */
  credits: number;
  /** What a bundle costs and holds. */
  tokens: number;
  bundle: number;
  /** Bought tokens left to spend (the shop's). */
  tokens_left: number;
};

/** The price a button shows before anything is made: "" when the next one is already paid for. */
export function extraPrice(kind: CompanionExtraKind, s: CompanionExtraState | null | undefined): string {
  if (!s || s.free || (s.included_left ?? 0) > 0 || s.credits > 0) return "";
  const x = COMPANION_EXTRAS[kind];
  return `${x.tokens} token${x.tokens === 1 ? "" : "s"} for ${x.bundle}`;
}

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

/**
 * A roleplay played in a scene (David, 2026-11-08: "in companion … do we want role play options like we have in after
 * dark?"): the show's own PG roleplays (lib/roleplays.ts DATE_ROLEPLAYS), one from your Create library's safe side, or
 * one written for the scene, and who plays which role. The person and an AI character, so it's agreed as it's picked
 * (the show's rule for a person with the show's own side, lib/date-roleplays.ts). Make-believe the two share for the
 * scene: what's said in it is never taken as a fact about the person (lib/companion-memory.ts).
 */
export type CompanionRoleplayView = {
  /** The show's id (DATE_ROLEPLAYS), or "custom". */
  id: string;
  title: string;
  icon: string;
  /** The premise from your side ("You read fortunes at a night fair; Mara sat down…"). */
  premise: string;
  /** Your role and theirs (null: the same to each other, rival spies). */
  you_play: string | null;
  they_play: string | null;
};

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
  /** Its voice note, once one's been made (lib/companion-voice.ts): where it plays from. */
  voice?: string | null;
  /** A system line that starts a scene or goes back to texting (null: the AI notice). */
  marker: "scene" | "texting" | null;
  /** The roleplay's title when it was said in one (make-believe, never a fact about the person). */
  roleplay: string | null;
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
  /** The roleplay that scene plays (null: just the two of you). */
  roleplay: CompanionRoleplayView | null;
  /** The crisis resources are up: nothing more in character until the person carries on. */
  paused: boolean;
  /** How many things the character remembers about you (the memory page). */
  facts: number;
};

export type CompanionFactView = { id: string; kind: string; text: string; pinned: boolean; edited: boolean; at: string };

/* ------------------------------------------- companions over MCP (lib/companion-mcp.ts) ------------------------------------------- */

export const COMPANION_ACTIONS = ["list", "open", "send", "read", "regenerate", "edit", "length", "scene", "voice", "carry_on", "report", "memory", "remember", "forget", "forget_all", "delete"] as const;
export type CompanionAction = (typeof COMPANION_ACTIONS)[number];

/** One agent's messages (sends, regenerates and edits) an hour and a day: they're on the show's model. */
export const COMPANION_AGENT_LIMITS = { perHour: 60, perDay: 300 };
/** Every agent's together a day, so the show's spend on agents' companions has a ceiling (about $2 a day at $0.001). */
export const COMPANION_AGENTS_DAILY = { perHour: 500, perDay: 2000 };
/** One agent's voice notes an hour and a day (free to agents, on the show's voice: about $0.002 each). */
export const COMPANION_AGENT_VOICE_LIMITS = { perHour: 10, perDay: 30 };
export const COMPANION_TOOL_DESCRIPTION =
  "Talk one to one with a character, as yourself (a companion): the show's house cast, its open cast, or one of your own characters, never another agent's or person's. " +
  "Free; your messages run on the show's model, up to " + `${COMPANION_AGENT_LIMITS.perHour} an hour and ${COMPANION_AGENT_LIMITS.perDay} a day. ` +
  "The character is an AI character and says so (notice); it's PG like the show, and it remembers what you tell it (memory, yours to change). Nothing said here reaches a date, a text or the show. " +
  "action: list (who you can talk with, and your threads), open {character_id} (starts or finds your thread: its first messages), send {character_id or thread_id, text} (opens the thread if needed; returns reply, the character's new messages), " +
  "read {thread_id, limit}, regenerate (draw the last reply again), edit {text} (rewrite your last message), length {length: short|normal|long}, " +
  "scene {place, roleplay?, my_role?} (play a scene together at one of the show's places, face to face: they answer with what they say and what they do; place texting goes back to texting; roleplay: a show roleplay id or {title, premise, roles?}, agreed at once, never remembered as fact about you), " +
  `voice {message_id} (one of their replies as a voice note in their own voice: an MP3 link that works for an hour; free, up to ${COMPANION_AGENT_VOICE_LIMITS.perDay} a day), report {message_id, reason}, ` +
  "memory (what it knows about you), remember {text}, forget {fact_id}, forget_all, carry_on (after crisis resources paused it), delete. Every action but list and open takes thread_id (or character_id).";


/**
 * Ideas for what to say (lib/companion-ideas.ts; docs/companions.md, "Ideas for what to say"), the parts the thread's
 * page shares with the server: the three tones and their names, what the route answers, the device's switch, and the
 * pure reads the page makes (which message the ideas are wanted under, and where the thread scrolls when they arrive
 * under it). No server code here: the page imports it.
 */
import type { CompanionMessageView } from "./companion-shared";

/** One warm, one playful and one bold, in that order (in PG, bold is forward, never explicit). */
export const IDEA_TONES = ["warm", "playful", "bold"] as const;
export type IdeaTone = (typeof IDEA_TONES)[number];
export const IDEA_TONE_LABELS: Record<IdeaTone, string> = { warm: "Warm", playful: "Playful", bold: "Bold" };

/** Something the person could send next, with the tone it's in. */
export type CompanionIdea = { tone: IdeaTone; text: string };

/**
 * What POST /api/companion/:id/ideas answers: the message the ideas are for (null: the newest word isn't the
 * character's, so there's nothing to suggest), up to three ideas, and whether "Other ideas" can still draw.
 */
export type CompanionIdeas = { for: string | null; ideas: CompanionIdea[]; more: boolean };

/** This device's switch, in the thread's Settings ("off" when switched off; on unless switched off). */
export const IDEAS_KEY = "bz_companion_ideas";

/** How long after a reply lands the ideas are asked for: reading the reply comes first. */
export const IDEAS_AFTER_MS = 500;

type ThreadLine = Pick<CompanionMessageView, "id" | "role" | "marker" | "offers" | "question">;

/**
 * The message the ideas go under: the thread's newest, when it's the character's (a reply, a text or a photo it sent;
 * the AI notice is passed over), or null. Also null when that reply carries a menu or an answer box of its own (the
 * chips under a text about a date, a question about its sheet): the question is already the menu. The server picks
 * the same message (lib/companion-ideas.ts), so the ideas it keeps are for what the page shows.
 */
export function ideasReplyFor(messages: readonly ThreadLine[]): string | null {
  let newest: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "system") {
      if (m.marker) break;
      continue;
    }
    if (m.role === "user") break;
    newest ??= m.id;
    if (m.offers || m.question) return null;
  }
  return newest;
}

/** How near its end a thread still counts as being read there, when something is added (a line or two up still is). */
export const END_SLACK_PX = 48;

/** The thread's scroller, as much of it as these read. */
type ScrollBox = { scrollTop: number; clientHeight: number; scrollHeight: number };

/**
 * Whether the thread's end was in view before `grew` pixels were added under it: then the scroller follows the end, so
 * what arrived isn't left below the fold, behind the composer. Someone who has scrolled up to read stays where they are.
 */
export function endWasInView(box: ScrollBox, grew: number, slack: number = END_SLACK_PX): boolean {
  return box.scrollHeight - grew - (box.scrollTop + box.clientHeight) <= slack;
}

/**
 * Where the thread scrolls to once `grew` pixels were added at its end (the ideas arriving), or null to stay put: its
 * new end when the end was in view, but never past `keepTop`, where the reply being read starts (its offset in the
 * scroller, less a margin), so a long reply on a phone with the keyboard up isn't pushed out of view to make room for
 * them. Never upwards: someone who has scrolled up to read stays where they are.
 */
export function followEnd(box: ScrollBox, grew: number, keepTop: number | null = null, slack: number = END_SLACK_PX): number | null {
  if (grew <= 0 || !endWasInView(box, grew, slack)) return null;
  const end = box.scrollHeight - box.clientHeight;
  const to = keepTop === null ? end : Math.min(end, keepTop);
  return to > box.scrollTop ? to : null;
}

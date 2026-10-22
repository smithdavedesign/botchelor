/**
 * People's feedback (David, 2026-10-22: "let's add a way for user to send feedback so we go to beta we get opinions"):
 * the rules both sides need. The page (app/FeedbackModal.tsx, app/FeedbackDock.tsx) and the server (lib/user-feedback.ts,
 * /api/feedback) import this file, so it stays free of the database and of node-only modules.
 *
 * Kept apart from what agents send (lib/feedback.ts, agent_feedback): agents' board and the home page's bot reviews
 * never read people's notes.
 */

export const FEEDBACK_CATEGORIES = ["bug", "idea", "love", "confusing", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug",
  idea: "Idea",
  love: "Love it",
  confusing: "Confusing",
  other: "Other",
};

/** The owner's triage on /admin/feedback?tab=people: every note arrives new. */
export const FEEDBACK_STATUSES = ["new", "seen", "done"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Long enough for a real bug report, short enough to read in one sitting. */
export const FEEDBACK_MESSAGE_MAX = 2000;
export const FEEDBACK_EMAIL_MAX = 254;
export const FEEDBACK_NOTE_MAX = 2000;
export const RATING_MIN = 0;
export const RATING_MAX = 10;

/** Anything on the page opens the modal by dispatching this on window: the footer link, the button, the beta prompt. */
export const OPEN_FEEDBACK_EVENT = "bz:feedback";
export const openFeedback = (): void => {
  window.dispatchEvent(new Event(OPEN_FEEDBACK_EVENT));
};

/** This browser has shown the beta prompt (localStorage). Accounts also keep it on the server (accounts.beta_prompt_at). */
export const BETA_PROMPT_KEY = "bz_beta_prompt";

/**
 * Net Promoter Score from the 0-10 answers: the share who'd recommend us (9-10) minus the share who wouldn't (0-6),
 * as a whole number from -100 to 100. Null with no answers, rather than a misleading 0.
 */
export function npsScore(counts: { promoters: number; detractors: number; rated: number }): number | null {
  if (counts.rated <= 0) return null;
  return Math.round(((counts.promoters - counts.detractors) / counts.rated) * 100);
}

/** Which NPS group one answer falls in. */
export const npsGroup = (rating: number): "promoter" | "passive" | "detractor" =>
  rating >= 9 ? "promoter" : rating >= 7 ? "passive" : "detractor";

export type BetaPromptState = {
  /** A date of theirs has aired (or finished as a private one, which never airs): they've used the show. */
  usedIt: boolean;
  /** This browser already showed it (localStorage). */
  seenHere: boolean;
  /** Their account already showed it, on any device. */
  seenOnAccount: boolean;
  /** A crawler or an AI agent, not a person. */
  agent: boolean;
  /** They're somewhere it would get in the way: the 18+ gate, a full-screen theater, the phone swipe deck. */
  blocked: boolean;
};

/**
 * The one-time beta prompt ("Botchelor's in beta: how's it going?"): once a person has watched a date of their own, ask
 * once, then never again on this browser or (with an account) anywhere. Never to agents, never where it would cover
 * the show.
 */
export function betaPromptDue(s: BetaPromptState): boolean {
  return s.usedIt && !s.seenHere && !s.seenOnAccount && !s.agent && !s.blocked;
}

/** Pages the prompt never interrupts: the gate, an unsubscribe link, the owner's admin pages and After Dark's stage. */
export function promptPathBlocked(pathname: string): boolean {
  return pathname === "/gate" || /^\/(admin|after-dark|email)(\/|$)/.test(pathname);
}

/** The page a note was sent from: a path only, never its query or hash (they can carry tokens). Null if it isn't one. */
export function cleanPage(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  const path = value.split(/[?#]/)[0].slice(0, 200);
  return path || null;
}

/** "390x844": the viewport in CSS pixels, or null when it isn't that shape. */
export function cleanViewport(value: unknown): string | null {
  return typeof value === "string" && /^\d{2,5}x\d{2,5}$/.test(value) ? value : null;
}

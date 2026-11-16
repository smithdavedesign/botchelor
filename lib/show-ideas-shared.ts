/**
 * Show ideas, the parts a browser may load too (lib/show-ideas.ts has the rules and the database): the three answers,
 * the limits a form shows, and the shapes the page is given. A leaf: no imports.
 */

/** The three answers, weakest signal first. */
export const INTERESTS = ["watch", "enter", "produce"] as const;
export type Interest = (typeof INTERESTS)[number];
export const INTEREST_LABEL: Record<Interest, string> = { watch: "I'd watch", enter: "I'd enter a character", produce: "I'd produce it" };
export type Picks = Record<Interest, boolean>;
export const NO_PICKS: Picks = { watch: false, enter: false, produce: false };

export type VoterKind = "person" | "agent";

export const TITLE_MIN = 3;
export const TITLE_MAX = 60;
export const PITCH_MIN = 20;
export const PITCH_MAX = 280;
/** How many proposals one person can have waiting or listed from the last 30 days. */
export const PROPOSALS_PER_30_DAYS = 3;

export type Tally = { watch: number; enter: number; produce: number; voters: number };

export type IdeaView = {
  id: string;
  title: string;
  pitch: string;
  emoji: string;
  /** One of the house's own (HOUSE_IDEAS), else someone's proposal. */
  house: boolean;
  /** Who proposed it, for a proposal: a person or an agent (never who). */
  proposed_by: VoterKind | null;
  /** Only ever "waiting" on the proposer's own view of their own proposal; everything else listed is "listed". */
  status: "listed" | "waiting";
  people: Tally;
  agents: Tally;
  /** This viewer's own answers; all false when they haven't answered. */
  mine: Picks;
  /** Whether this viewer may answer (a waiting proposal takes no votes). */
  open: boolean;
};

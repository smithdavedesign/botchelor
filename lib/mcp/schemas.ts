/**
 * The JsonSchema building blocks every tool definition uses. First step of the lib/mcp.ts split
 * (docs/split-mcp-plan.md), chosen because these have no circular deps: upstream constants only.
 */
import { DATE_VISIBILITIES } from "../rules";
import { DEFAULT_FORMAT, FORMAT_IDS } from "../formats";
import type { PartnerStyle } from "../partners-shared";

export type JsonSchema = Record<string, unknown>;

/**
 * The 30-second cap on every wait_seconds (my_status, read_texts, get_episode, …): the longest a single call waits.
 * #1057 (the 2026-10-30-2233 run): at 50 the edge in front of the app sometimes answered a wait with a bare
 * "error code: 504"; waits of 40 seconds or less never did, so the cap, and every wait we suggest, is 30.
 */
export const WAIT_MAX_SECONDS = 30;

/** #1057: one line for the cheatsheets: a bare 504 on a wait is the edge's, and a wait only reads. */
export const WAIT_504_NOTE = "A bare 504 (error code: 504, not JSON) on a wait is the edge in front of the show, not your call: waits only read, so it's safe to retry.";

/** How often a wait loop re-checks (lib/mcp.ts). Kept as a sibling for symmetry with WAIT_MAX_SECONDS. */
export const WAIT_POLL_MS = 2000;

/** #488: a leaderboard place held on fewer reviews than this is provisional. */
export const LEADERBOARD_MIN_REVIEWS = 3;

/** Short helper for string props: fixed max-length plus an optional description. */
export const str = (max: number, description?: string): JsonSchema => ({
  type: "string",
  maxLength: max,
  ...(description ? { description } : {}),
});

/** Repeated across ~46 tools; the welcome text says what it's for (lib/mcp.ts initialize). */
export const AGENT_ID: JsonSchema = { type: "string", description: "Optional within a session." };

export const COMPACT_STEP_VALUES = [true, false, "delta"] as const;
/**
 * 2.8.0 (the 2026-10-22-0400 run, #633's comment: "drop the repeated step.messages prompt after the first turn"): left out,
 * a step after start_own_date's first leaves the prompt out (lib/mcp/dispatcher.ts compactIf); true is what the default was.
 */
export const COMPACT_STEP: JsonSchema = {
  type: ["boolean", "string"],
  enum: [...COMPACT_STEP_VALUES],
  description:
    "Left out: after start_own_date's first step, no prompt (write the line from transcript). true: this turn's messages, minus the " +
    "unchanging system message. \"delta\": no messages (keep each side's conversation: last_lines). false: everything.",
};

/** #485/#490: a dry run on a tool that spends or starts something. */
export const PREVIEW = (what: string): JsonSchema => ({
  type: "boolean",
  default: false,
  description: `true: ${what}, and nothing is started or spent.`,
});

export const SINCE_TURN: JsonSchema = {
  type: "integer",
  minimum: 0,
  description:
    "Only the transcript from this line on (0-based; transcript_total says how many there are), for polling a date being written.",
};

/** #543: what each visibility changes, in one place (the schema, set_date_visibility and its reply all say it). */
export const VISIBILITY_RULES: Record<(typeof DATE_VISIBILITIES)[number], string> = {
  public: "in the feed; airs on its own (predictions close when it does); predictions score points on it; it counts in the character's public record and memory, and on the couple page",
  unlisted: "anyone with the link; airs on its own like a public date; not in the feed, no predictions or points, and out of the public record and character memory (the two characters still remember it between them)",
  private: "offline: its owners only; never airs, no predictions, no second date, out of the record and memory (the two characters still remember it between them)",
};

export const visibilityRules = (): string =>
  DATE_VISIBILITIES.map((v) => `${v}: ${VISIBILITY_RULES[v]}`).join(". ");

export const VISIBILITY: JsonSchema = {
  type: "string",
  enum: [...DATE_VISIBILITIES],
  default: "public",
  description:
    "public (default): the feed; airs on its own, closing predictions; scores and counts in the record. unlisted: anyone with the link; airs; no feed, points or record. private: offline, owners only, never airs, no second date. Full rules: set_date_visibility.",
};

export const FORMAT: JsonSchema = {
  type: "string",
  enum: [...FORMAT_IDS],
  default: DEFAULT_FORMAT,
  description: `Optional show format (default ${DEFAULT_FORMAT}; speed_date: six lines).`,
};

export const WAIT = (what: string): JsonSchema => ({
  type: "integer",
  minimum: 0,
  maximum: WAIT_MAX_SECONDS,
  default: 0,
  // 2.8.0 (#649): every wait also wakes when something needs you now (returned_because: your_move, heads_up first).
  description: `${what} (default 0: answer now; your move wakes it early).`,
});

/** What a PARTNER_STYLE choice means, used by create_character's reply (lib/mcp.ts partnerStyleEcho). */
export const PARTNER_STYLE_MEANS: Record<PartnerStyle, string> = {
  one: "One partner: once it's in a Dating couple with someone, it closes to other dates (you're told one date before: exclusive_soon).",
  open: "More than one (the default): it keeps dating others, even in a Dating couple. Its couples still move up a stage (Sparks, Dating) as their dates go: open only means it never closes to other dates.",
  decide: "Its own call: it settles one partner or more from its temperament when it first gets serious. If it settles on one, it closes to other dates once it's in a Dating couple.",
};

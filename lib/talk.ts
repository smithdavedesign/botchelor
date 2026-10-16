/**
 * How much a character talks: an owner setting for the length of the date (spoken lines) and the texts the
 * morning after. Never touches the outcome: the engine decides how a date ends before a line is written, so a
 * longer date is more of the same story, never a different ending.
 *
 * The floor is the show's standard length. Each owner sets a minimum for their own character and a date runs
 * at the longer of the two, so neither side is cut short. The show pays for up to "long"; "marathon" is only on
 * the owners' own keys: it applies when BOTH sides of the date run on a creator's key (lib/keys buildKeyForSide),
 * else the date runs "long". Marathon is still bounded: one date has to finish inside a single function run.
 */
import { AFTERGLOW_TURNS, CONVERSATION_TURNS } from "./rules";

export const TALK_LEVELS = ["standard", "longer", "long", "marathon"] as const;
export type TalkLevel = (typeof TALK_LEVELS)[number];

export const isTalkLevel = (v: unknown): v is TalkLevel => typeof v === "string" && (TALK_LEVELS as readonly string[]).includes(v);

/** Spoken lines on the date and texts the morning after, per level. Standard is the show as it always was. */
export const TALK: Record<TalkLevel, { date: number; texts: number; label: string; hint: string }> = {
  standard: { date: CONVERSATION_TURNS, texts: AFTERGLOW_TURNS, label: "Standard", hint: `${CONVERSATION_TURNS} lines, ${AFTERGLOW_TURNS} texts` },
  longer: { date: 14, texts: 6, label: "Longer", hint: "14 lines, 6 texts" },
  long: { date: 18, texts: 8, label: "Long", hint: "18 lines, 8 texts" },
  marathon: { date: 30, texts: 16, label: "Marathon", hint: "30 lines, 16 texts, on your own key" },
};

const RANK: Record<TalkLevel, number> = { standard: 0, longer: 1, long: 2, marathon: 3 };

/**
 * The lengths a date runs at: the longer of the two owners' settings, never below the standard. A format with
 * its own length (the speed date is short on purpose) keeps it; only the texts after follow the setting.
 * Marathon only when both sides run on an owner's key; else long.
 */
export function talkFor(
  levels: [TalkLevel | null | undefined, TalkLevel | null | undefined],
  bothOnOwnKeys: boolean,
  formatTurns?: number,
): { level: TalkLevel; date: number; texts: number } {
  let level: TalkLevel = "standard";
  for (const l of levels) if (l && RANK[l] > RANK[level]) level = l;
  if (level === "marathon" && !bothOnOwnKeys) level = "long";
  return { level, date: formatTurns ?? TALK[level].date, texts: TALK[level].texts };
}

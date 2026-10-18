/** A couple's text chain: its types and how a day reads, safe for client components (the chain lives in lib/text-chain.ts). */
import type { End } from "./relationships";

/** A date between them, as a marker in the chain. */
export type ChainDate = {
  kind: "date";
  /** Sorts the chain and pages it: the time, the order within that moment, then what it is. Unique. */
  id: string;
  at: string;
  /** The UTC day, "2026-10-16". */
  day: string;
  episode_id: string;
  /** Which of their dates this was (1, 2, ...), counting the dates this viewer can see, like the couple page. */
  number: number;
  venue: string;
  /** How it ended, as the couple's timeline tells it (lib/relationships.ts timelineLabel). */
  ending_label: string;
  aired: boolean;
};

/** One text. `who` is the end that sent it. */
export type ChainText = {
  kind: "text";
  id: string;
  at: string;
  day: string;
  who: End;
  text: string;
  /** The morning after a date (the afterglow, `episode_id` is that date), or a text between dates. */
  source: "afterglow" | "between";
  episode_id: string | null;
};

export type ChainItem = ChainDate | ChainText;

/** One page of the chain, oldest first. `cursor` asks for the page before it; null at the start of their texts. */
export type ChainPage = { items: ChainItem[]; cursor: string | null; has_more: boolean };

/** How long one text may be: open-ended (a text is as long as its writer wants), with a ceiling only against abuse. */
export const TEXT_MAX = 10_000;

/** How many items a page holds: the newest page first, then earlier ones as the reader scrolls up. */
export const CHAIN_PAGE = 60;

export const isText = (item: ChainItem): item is ChainText => item.kind === "text";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A day the way a phone's thread shows it: "Today", "Yesterday", or "Thu, Oct 16" (with the year when it isn't this
 * one). UTC, and no Intl, so the server and the browser print the same thing.
 */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  if (t.getTime() - d.getTime() === 86_400_000) return "Yesterday";
  const label = `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === t.getUTCFullYear() ? label : `${label}, ${d.getUTCFullYear()}`;
}

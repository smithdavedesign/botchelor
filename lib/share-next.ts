/**
 * "Whose character should go next?" (the 2026-11-23 growth wave): right after an owner's date has aired, one compact
 * card asks them to send the date to a friend, who makes a character in a minute and could date theirs. Owners whose
 * date just aired are the warmest people the show has; the report card and its share existed, but were never offered
 * at that moment.
 *
 * The link is the date's report card (lib/report-card.ts) when it has one, else the episode itself, tagged `ref=next`
 * (app/funnel.ts BEACON_REFS → source next_share, lib/engagement.ts), so these visitors count apart from a report
 * card's own shares (`ref=report`). A bring-a-friend double link (lib/double-links.ts) was the other choice: it needs a
 * signed-in owner, a POST that spends nothing only once both sides have dates on hand, and can refuse at the moment
 * of sharing, so the report card, which every aired public date has, is the link.
 *
 * Who sees it: only an owner of one of the two, only once the date has aired, only on a public date that isn't hidden,
 * and only when both characters are public (the privacy rule: nothing private, unlisted or unaired is shown to a
 * stranger, and a shared link is for strangers). SHARE_NEXT=0 hides it everywhere. Pure, so the page and tests agree.
 */
import { reportCardPath } from "./report-card";

/** The share tag on the card's link (app/funnel.ts BEACON_REFS → source next_share). */
export const SHARE_NEXT_REF = "next";

/** The event prop that tells this share apart from the report card page's own (data-track-where). */
export const SHARE_NEXT_WHERE = "next_prompt";

export const SHARE_NEXT_TITLE = "Whose character should go next?";
export const SHARE_NEXT_LINE = "Send this date to a friend. They make a character in a minute, and it could date yours.";
export const SHARE_NEXT_BUTTON = "Send it to a friend";

/** SHARE_NEXT=0 (or off) hides the card; unset, or anything else, leaves it on. */
export function shareNextOn(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.SHARE_NEXT?.trim().toLowerCase();
  return v !== "0" && v !== "off";
}

export type ShareNextFacts = {
  /** The viewer owns one of the two characters (EpisodeView.is_creator). */
  isOwner: boolean;
  /** The finale has aired. */
  revealed: boolean;
  visibility: "public" | "private" | "unlisted";
  hidden: boolean;
  /** Both characters are public (characters.visibility), whoever owns them. */
  bothPublic: boolean;
};

/** Whether this viewer gets the card: an owner, on a date that aired publicly between two public characters. */
export function shareNextShown(f: ShareNextFacts, env: Record<string, string | undefined> = process.env): boolean {
  return shareNextOn(env) && f.isOwner && f.revealed && f.visibility === "public" && !f.hidden && f.bothPublic;
}

/** The link the card shares: the report card when the date has one, else the episode, tagged ref=next. */
export function shareNextPath(episodeId: string, hasReportCard: boolean): string {
  const page = hasReportCard ? reportCardPath(episodeId) : `/episodes/${encodeURIComponent(episodeId)}`;
  return `${page}?ref=${SHARE_NEXT_REF}`;
}

/** The share sheet's words: who dated, and the ask. */
export const shareNextText = (names: [string, string]) => `${names[0]} × ${names[1]} went on an AI blind date on Botchelor. Make a character and yours could be next.`;

/** Where a dismissal is remembered, one key per episode (localStorage). */
export const shareNextDismissKey = (episodeId: string) => `bz-share-next-dismissed:${episodeId}`;

/** What the card component needs, built once on the page. */
export type ShareNextCard = { episodeId: string; path: string; names: [string, string]; event: string };

/** The card's props, or null when this viewer doesn't get it. `event`: the share event the link's kind already fires. */
export function shareNextCard(
  episode: { id: string; characters: { name: string }[]; is_creator: boolean } & Omit<ShareNextFacts, "bothPublic" | "isOwner">,
  bothPublic: boolean,
  reportCard: string | null,
  env: Record<string, string | undefined> = process.env,
): ShareNextCard | null {
  const facts = { isOwner: episode.is_creator, revealed: episode.revealed, visibility: episode.visibility, hidden: episode.hidden, bothPublic };
  if (!shareNextShown(facts, env)) return null;
  const [a, b] = episode.characters;
  if (!a || !b) return null;
  return { episodeId: episode.id, path: shareNextPath(episode.id, Boolean(reportCard)), names: [a.name, b.name], event: reportCard ? "share-report-card" : "share-episode" };
}

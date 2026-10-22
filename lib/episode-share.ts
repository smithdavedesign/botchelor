/**
 * Sharing an episode (GROWTH.md, 2026-10-21): the link a viewer shares, the words that go with it, and the
 * description its preview shows. Pure, so the page, its share buttons and the card agree, and tests read them directly.
 *
 * Nothing here ever names a creator or the ending: a preview is seen by people who haven't watched, and creators stay
 * anonymous unless both agree (lib/game.ts). The characters are public, so they're the headline.
 */
import { ENDING_LABELS, ENDINGS } from "./rules";

/** The tag on every shared episode link, so RepoHQ's beacon tells these visits apart from "direct" (app/funnel.ts). */
export const SHARE_REF = "share";

/** The question the card and the poll ask. */
export const SHARE_QUESTION = "How does it end?";

/** The card's address: /api/og/episode/<id> (app/api/og/episode/[id]/route.tsx). */
export const episodeCardPath = (id: string) => `/api/og/episode/${encodeURIComponent(id)}`;

/** The page's address with the share tag: what Copy link, Reddit and Bluesky all share. */
export const sharedEpisodePath = (path: string) => `${path}${path.includes("?") ? "&" : "?"}ref=${SHARE_REF}`;

const clip = (s: string, max: number) => (max <= 1 ? "" : s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Search and link-preview descriptions stay this short (Google cuts at about 160; cards show two or three lines). */
export const SHARE_DESCRIPTION_MAX = 200;

/**
 * The page's description and og:description: who meets whom, the setting (the teaser, never a spoiler), and the
 * invitation. The setting is cut to fit, so "Guess how it ends" is always there. It never lists the endings: a
 * description that says "just friends" would read as a hint.
 */
export function shareDescription(names: [string, string], setting: string, aired: boolean): string {
  const lead = `${names[0]} meets ${names[1]}.`;
  const ask = aired ? "Guess how it ends, then watch the date." : "Guess how it ends before the finale airs, for free points.";
  const room = SHARE_DESCRIPTION_MAX - lead.length - ask.length - 2;
  const teaser = clip(setting.trim(), room);
  return clip([lead, teaser, ask].filter(Boolean).join(" "), SHARE_DESCRIPTION_MAX);
}

/** The headline a shared link carries: on Reddit its title, on the card and in og:title. */
export const shareTitle = (names: [string, string]) => `${names[0]} × ${names[1]} went on an AI blind date. ${SHARE_QUESTION}`;

/**
 * A descriptive page title for the HTML <title> and SEO (richer than shareTitle because search listings favour
 * long-tail titles that include the setting; "an AI blind date" alone matches thousands of pages). It keeps the
 * venue when it's known and short, and never leaks the ending. The ending-tag goes on the SOCIAL card title
 * (shareTitle) only, so a Google snippet never spoils what a visitor can also predict for points.
 */
export function pageTitle(names: [string, string], venue: string | null): string {
  const base = `${names[0]} × ${names[1]}: an AI blind date`;
  const where = venue && venue.length <= 60 ? ` at ${venue}` : "";
  return `${base}${where} · Botchelor`;
}

/** "a second date, just friends or a disaster", from the poll's own labels. */
const endingsInWords = () => {
  const labels = ENDINGS.map((e) => ENDING_LABELS[e].toLowerCase());
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
};

// %20 rather than URLSearchParams' "+": not every share page reads "+" as a space.
const query = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

/** Reddit's submit page, with the link and a title filled in. */
export const redditShareUrl = (url: string, names: [string, string]) => `https://www.reddit.com/submit?${query({ url, title: shareTitle(names) })}`;

/** Bluesky's composer, with a post and the link filled in (Bluesky unfurls the link into the card). */
export const blueskyShareUrl = (url: string, names: [string, string]) =>
  `https://bsky.app/intent/compose?${query({ text: `${names[0]} × ${names[1]} went on an AI blind date. How does it end: ${endingsInWords()}? ${url}` })}`;

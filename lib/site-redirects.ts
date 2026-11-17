/**
 * Addresses people type because the show's tabs and nav use the words (2026-11-07 audit, item 14: /reels, /seasons and
 * /messages were 404s while the tabs said "Reels" and "Seasons" and Dating holds the messages). Each goes to the page
 * that word means. Temporary (307): the words may get pages of their own, as /seasons did (app/seasons/page.tsx,
 * 2026-11-11), so it left this list.
 */
import { seasonPath } from "./season-ref";

export type SiteRedirect = { source: string; destination: string; permanent: false };

/** December 2026, The Botchelor's first month (lib/season-format.ts): the season the December clips are about. */
const DECEMBER_2026 = "2026-12-01";

export const SHOW_WORD_REDIRECTS: readonly SiteRedirect[] = [
  // The Gallery's reels view (app/showcase/reels), and the Chat door, which holds every thread since 2026-11-15 (NAV_CHAT).
  { source: "/reels", destination: "/showcase/reels", permanent: false },
  { source: "/messages", destination: "/chat", permanent: false },
  // The short address the December clips print on their end cards (scripts/clips/episode-cut.mjs, docs/clips/): the
  // season's own page (docs/season-page.md), watch-first before it starts and while it runs, its finale after. People
  // type it from a video, so it carries its own utm tags (as /vote does) for the engagement log to count them.
  { source: "/december", destination: `${seasonPath(DECEMBER_2026)}?utm_source=clip&utm_medium=clip&utm_campaign=december`, permanent: false },
];

/**
 * Addresses people type because the show's tabs and nav use the words (2026-11-07 audit, item 14: /reels, /seasons and
 * /messages were 404s while the tabs said "Reels" and "Seasons" and Dating holds the messages). Each goes to the page
 * that word means. Temporary (307): the words may get pages of their own, as /seasons did (app/seasons/page.tsx,
 * 2026-11-11), so it left this list.
 */
export type SiteRedirect = { source: string; destination: string; permanent: false };

export const SHOW_WORD_REDIRECTS: readonly SiteRedirect[] = [
  { source: "/reels", destination: "/showcase", permanent: false },
  { source: "/messages", destination: "/matches", permanent: false },
  // The short address the December clips print on their end cards (scripts/clips/episode-cut.mjs, docs/clips/): it goes
  // where December is happening now, the casting board until the season page takes over. People type it from a video,
  // so it carries its own utm tags (as /vote does) for the engagement log to count them.
  { source: "/december", destination: "/casting?utm_source=clip&utm_medium=clip&utm_campaign=december", permanent: false },
];

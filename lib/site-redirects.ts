/**
 * Addresses people type because the show's tabs and nav use the words (2026-11-07 audit, item 14: /reels, /seasons and
 * /messages were 404s while the tabs said "Reels" and "Seasons" and Dating holds the messages). Each goes to the page
 * that word means. Temporary (307): the words may get pages of their own.
 */
export type SiteRedirect = { source: string; destination: string; permanent: false };

export const SHOW_WORD_REDIRECTS: readonly SiteRedirect[] = [
  { source: "/reels", destination: "/showcase", permanent: false },
  { source: "/seasons", destination: "/reunion", permanent: false },
  { source: "/messages", destination: "/matches", permanent: false },
];

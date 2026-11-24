/**
 * Static pages that were rewritten, and when (moved here from lib/indexnow.ts on 2026-11-23 so the sitemap can read it
 * too). Two readers:
 * - IndexNow's daily job (lib/indexnow.ts changedLandingUrls): its window (the last 26 hours) covers each date once, so
 *   the engines hear about the new words once, the day after they ship, and never again.
 * - The sitemap (lib/seo.ts staticSitemap): a rewritten page's <lastmod> is the day it shipped (landingLastModified),
 *   so Google, which ignores changefreq and priority, has an honest date to recrawl by. A page with no line here gets
 *   no lastmod at all rather than a guess.
 * Add a line when a landing page changes enough to be worth a re-crawl; the date is the day after the merge (the job
 * runs at 16:20 UTC).
 */
export type LandingChange = { path: string; changedAt: string };

export const LANDING_CHANGES: readonly LandingChange[] = [
  // The Character.AI rescue door (2026-11-14): /import's ?from=cai copy and the landing's new words.
  { path: "/import", changedAt: "2026-11-15T00:00:00Z" },
  { path: "/alternatives/character-ai", changedAt: "2026-11-15T00:00:00Z" },
  // New titles that say "AI" (2026-11-22 audit), and the landings search engines had listed but never fetched.
  ...["/", "/create", "/pricing", "/faq", "/seasons", "/contact", "/press", "/security", "/import", "/reviews"].map((path) => ({ path, changedAt: "2026-11-23T00:00:00Z" })),
  ...["character-ai", "janitor-ai", "spicychat", "chai"].map((slug) => ({ path: `/alternatives/${slug}`, changedAt: "2026-11-23T00:00:00Z" })),
  // The ship tools (2026-11-23): the new random ship generator, and the chemistry test re-aimed as the ship
  // compatibility test. A day after they ship, so the job never sends a search engine to a page not yet deployed.
  ...["/tools/random-ship-generator", "/tools/oc-chemistry-test"].map((path) => ({ path, changedAt: "2026-11-24T00:00:00Z" })),
  // The /alternatives pages as dated lists of the apps people use instead (2026-11-23, lib/alternative-apps.ts): new
  // titles, a new heading and the list. The day after the merge, as above.
  ...["character-ai", "janitor-ai", "spicychat", "chai"].map((slug) => ({ path: `/alternatives/${slug}`, changedAt: "2026-11-24T00:00:00Z" })),
  // How to save your Character.AI characters and chats (2026-11-23, lib/cai-guide.ts): a new page. The day after the merge.
  { path: "/guides/save-character-ai", changedAt: "2026-11-24T00:00:00Z" },
  // The relationship trope generator (2026-11-23, lib/relationship-tropes.ts): a new tool. The day after the merge.
  { path: "/tools/relationship-trope-generator", changedAt: "2026-11-24T00:00:00Z" },
  // The making of Botchelor (2026-11-23, lib/making-of.ts): a new page. The day after the merge.
  { path: "/making-of", changedAt: "2026-11-24T00:00:00Z" },
];

const DAY_MS = 86_400_000;

/**
 * The day a landing page last shipped new words (YYYY-MM-DD, UTC), for its sitemap <lastmod>: its newest line, a day
 * before that line's changedAt (the merge day), and never a day still to come. Undefined for a page with no line.
 */
export function landingLastModified(path: string, now: Date = new Date(), changes: readonly LandingChange[] = LANDING_CHANGES): string | undefined {
  const today = now.toISOString().slice(0, 10);
  let last: string | undefined;
  for (const c of changes) {
    if (c.path !== path) continue;
    const shipped = new Date(new Date(c.changedAt).getTime() - DAY_MS).toISOString().slice(0, 10);
    if (shipped <= today && (!last || shipped > last)) last = shipped;
  }
  return last;
}

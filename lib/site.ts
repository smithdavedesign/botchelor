/**
 * The site's public address, for absolute URLs (sitemap, robots.txt, og:image). On Vercel that is the
 * production domain Vercel sets in VERCEL_PROJECT_PRODUCTION_URL (a host name, no scheme); elsewhere
 * localhost, which is what `next start` serves.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host ? `https://${host}` : "http://localhost:3000";
}

/** The pages worth listing for search engines: public, and the same for every visitor. */
export const PUBLIC_PATHS = ["/", "/feed", "/cast", "/shop", "/terms", "/privacy"] as const;

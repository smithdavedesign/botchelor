/**
 * The site's public address, for absolute URLs (sitemap, robots.txt, og:image). On Vercel that is the
 * production domain Vercel sets in VERCEL_PROJECT_PRODUCTION_URL (a host name, no scheme); elsewhere
 * localhost, which is what `next start` serves.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host ? `https://${host}` : "http://localhost:3000";
}

/**
 * The address to put in links an agent will follow (the guides, the MCP discovery file, the schema's $id): the
 * production domain on Vercel, else the address this request came in on, so a local or preview server never
 * advertises a host it isn't on.
 */
export function requestBase(req: Request, env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) return siteUrl(env);
  try {
    return new URL(req.url).origin;
  } catch {
    return siteUrl(env);
  }
}

/** The pages worth listing for search engines: public, and the same for every visitor. */
export const PUBLIC_PATHS = [
  "/",
  "/create",
  "/watch",
  "/cast",
  "/characters",
  "/agents",
  "/shop",
  "/terms",
  "/privacy",
  "/tools/ship-name-generator",
  "/tools/oc-chemistry-test",
] as const;

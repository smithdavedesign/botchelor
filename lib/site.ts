/**
 * The site's public address, for absolute URLs (sitemap, robots.txt, og:image). On Vercel that is the
 * production domain Vercel sets in VERCEL_PROJECT_PRODUCTION_URL (a host name, no scheme); elsewhere
 * localhost, which is what `next start` serves.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (host) return `https://${host}`;
  // A server that isn't on Vercel says where it is (the loop's arena runs on its own port: 2026-10-20 visitors got
  // link_account links to localhost:3000, which wasn't there).
  const own = env.SITE_URL?.trim().replace(/\/+$/, "");
  return own || "http://localhost:3000";
}

/**
 * The site's other addresses: the old one and www. Their pages move to the canonical domain (middleware.ts), and a
 * player's identity is carried across (app/api/auth/carry), which only ever sends a browser back to one of these.
 */
export const OLD_HOSTS: ReadonlySet<string> = new Set(["botchelor.vercel.app", "www.botchelor.com"]);

/** The host a request came in on (Vercel's forwarded host first), lowercased. */
export function requestHost(req: Request): string {
  return (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
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
  "/characters",
  "/characters?tab=people",
  "/characters?tab=agents",
  "/agents",
  "/shop",
  "/terms",
  "/privacy",
  "/tools/ship-name-generator",
] as const;

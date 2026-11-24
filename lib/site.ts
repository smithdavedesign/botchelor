import { afterDarkOnly, afterDarkOrigin } from "./after-dark-host";
import { isProductionDeploy } from "./deploy";

/**
 * The site's public address, for absolute URLs (sitemap, robots.txt, og:image). On Vercel that is the
 * production domain Vercel sets in VERCEL_PROJECT_PRODUCTION_URL (a host name, no scheme); on any other host the
 * deployment's SITE_URL (DigitalOcean: docs/hosting.md); else localhost, which is what `next start` serves.
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
 * Where "Back to the show" goes: "/" on the show, the show's own address on After Dark's host (whose "/" is After Dark).
 */
export function showHome(env: Record<string, string | undefined> = process.env): string {
  return afterDarkOnly(env) ? siteUrl(env) : "/";
}

/**
 * The site's other addresses: the old one and www. Their pages move to the canonical domain (proxy.ts), and a
 * player's identity is carried across (app/api/auth/carry), which only ever sends a browser back to one of these.
 */
export const OLD_HOSTS: ReadonlySet<string> = new Set(["botchelor.vercel.app", "www.botchelor.com"]);

/**
 * The host a request came in on, lowercased: its Host header, which the edge routes by. Never X-Forwarded-Host:
 * DigitalOcean's edge passes on whatever a client sends there (2026-11-22 audit; Vercel used to set it).
 */
export function requestHost(req: Request): string {
  return (req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
}

/**
 * The address to put in links an agent will follow (the guides, the MCP discovery file, the schema's $id): the
 * production domain on Vercel, else the address this request came in on, so a local or preview server never
 * advertises a host it isn't on. After Dark's own host (lib/after-dark-host.ts) runs behind its platform's proxy, where
 * req.url is the server's own address (localhost and its port), so there it's the address that host serves.
 */
export function requestBase(req: Request, env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) return siteUrl(env);
  const afterDark = afterDarkOnly(env) ? afterDarkOrigin(env) : null;
  if (afterDark) return afterDark;
  // The show's production deployment off Vercel: its own domain, not the address its platform's proxy forwards to.
  if (isProductionDeploy(env) && env.SITE_URL?.trim()) return siteUrl(env);
  try {
    return new URL(req.url).origin;
  } catch {
    return siteUrl(env);
  }
}

/**
 * The pages worth listing for search engines: public, and the same for every visitor. Not a page behind the 18+ gate:
 * crawlers pass it (proxy.ts), people don't, so a search result there landed on the gate (2026-11-22 audit: /shop,
 * whose prices /pricing shows in the open, and the prompts library).
 */
export const PUBLIC_PATHS = [
  "/",
  "/create",
  "/watch",
  "/reunion",
  "/house",
  "/graph",
  "/casting",
  "/characters",
  "/characters?tab=people",
  "/characters?tab=agents",
  "/agents",
  "/reviews",
  "/terms",
  "/privacy",
  "/content-policy",
  "/report",
  "/cancel",
  "/2257",
  // Every free tool on one page (app/tools/page.tsx, lib/tools.ts).
  "/tools",
  "/tools/random-oc-generator",
  "/tools/ship-name-generator",
  "/tools/random-ship-generator",
  "/tools/oc-chemistry-test",
  "/tools/relationship-trope-generator",
  "/tools/oc-name-generator",
  "/tools/place-name-generator",
  "/tools/oc-questions",
  "/about",
  "/costs",
  "/marketing",
  // The making of Botchelor (lib/making-of.ts): 42 days of screenshots, a time-lapse and the production line.
  "/making-of",
  "/safety",
  "/agents/pricing",
  // The model league (lib/model-league.ts): which model family's characters get the second dates.
  "/agents/league",
  // The MCP tool reference and the server's changelog, both generated from the server's own data (lib/mcp/reference.ts, lib/mcp/changelog.ts).
  "/agents/tools",
  "/agents/changelog",
  "/showcase",
  "/import",
  // Step into the date's cast picker (2026-11-15): open to everyone, the one playable thing that needs no character.
  "/step-in",
  "/alternatives/character-ai",
  // The company pages (2026-11-10, lib/company.ts).
  "/pricing",
  "/faq",
  "/contact",
  "/press",
  "/security",
  "/accessibility",
  // The Sunday letter's sign-up (lib/newsletter.ts).
  "/newsletter",
  // Every closed season's finale, one page (app/seasons/page.tsx).
  "/seasons",
  // The show on air and the ideas for what could come next (app/shows/page.tsx, lib/show-ideas.ts).
  "/shows",
  // Every page the footer used to list, in one place (app/everything/page.tsx, the 2026-11-14 design audit).
  "/everything",
] as const;

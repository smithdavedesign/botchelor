/**
 * After Dark on a host of its own (docs/after-dark-hosting.md). David, 2026-10-22: build the split now, leave it off,
 * and switch it on together with payments and age checks, before the first subscriber.
 *
 * Why: Vercel's terms ban "obscene" content, and Vercel may suspend a project "for any reason", which would take the PG
 * show down with After Dark. So After Dark can run as a second deployment of this same code, on a host whose terms
 * allow lawful adult content (DigitalOcean App Platform), with its pictures and clips on Bunny (lib/object-store.ts).
 * Both deployments use the same Neon database.
 *
 *   AFTER_DARK_ORIGIN   After Dark's address, e.g. https://ad.botchelor.com. Set on BOTH deployments.
 *                       On the show's deployment: After Dark's links point there, its pages and APIs redirect there,
 *                       and its MCP tools say to use the one there.
 *   AFTER_DARK_ONLY=1   on After Dark's own deployment (with SITE_URL set to the show's address): it serves After Dark,
 *                       the 18+ gate, the sign-in hop and the APIs its pages call, and sends everything else to the show.
 *
 * Unset (the default), nothing here does anything: every function answers what the code did before the split existed
 * (tests/after-dark-host.test.ts pins that). Pages are routed in middleware.ts and APIs by next.config.ts redirects:
 * the middleware never runs on /api, and making it run there would put it in front of every API call on the show. Both
 * read these at build time as well as at run time, so set them for both (Vercel does; on DigitalOcean, "Build and run").
 *
 * Edge-safe and dependency-free: middleware.ts, next.config.ts and client code (app/Nav.tsx) all import it.
 */

type Env = Record<string, string | undefined>;

/**
 * The two settings, each read as `process.env.NAME` in full: that is the expression next.config's `env` (set only when
 * the switch is on) replaces at build time, which is how client code such as app/Nav.tsx sees them. Unset, a browser
 * reads undefined, so its links stay as they were.
 */
function processEnv(): Env {
  try {
    return { AFTER_DARK_ORIGIN: process.env.AFTER_DARK_ORIGIN, AFTER_DARK_ONLY: process.env.AFTER_DARK_ONLY };
  } catch {
    return {};
  }
}

/** AFTER_DARK_ORIGIN as an origin (https://ad.botchelor.com, any path or trailing slash dropped), or null: unset or unusable. */
export function afterDarkOrigin(env: Env = processEnv()): string | null {
  const raw = env.AFTER_DARK_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** This deployment is After Dark's own host: AFTER_DARK_ONLY=1, with its address set. */
export function afterDarkOnly(env: Env = processEnv()): boolean {
  return env.AFTER_DARK_ONLY?.trim() === "1" && afterDarkOrigin(env) !== null;
}

/** On the show's deployment with After Dark moved out: where it went. Null on After Dark's own host, or with the switch off. */
export function afterDarkElsewhere(env: Env = processEnv()): string | null {
  return afterDarkOnly(env) ? null : afterDarkOrigin(env);
}

/** A root ending in "/" covers itself and everything under it; any other root is that one path. */
const covers = (root: string, pathname: string) =>
  root.endsWith("/") ? pathname === root.slice(0, -1) || pathname.startsWith(root) : pathname === root;

/** After Dark's pages: they move with it. */
export const AFTER_DARK_PAGES = ["/after-dark/", "/admin/after-dark/"] as const;

/**
 * After Dark's own APIs: they move with it, as do the looks builder's After Dark tiles (app/api/looks/[id], ids nsfw-…).
 * /api/after-dark/ is its billing: subscribing, and the processors' postbacks (paste After Dark's own address into the
 * merchant portals once it has one: a processor may not follow the show's redirect).
 */
export const AFTER_DARK_APIS = ["/api/admin/after-dark/", "/api/jobs/eval-after-dark", "/api/after-dark/"] as const;

/**
 * What else After Dark's own host serves, because its pages need it. A new API that an After Dark page calls goes here
 * (or under /api/admin/after-dark/), or that host sends it to the show, where a browser's call to it fails (CORS);
 * tests/after-dark-host.test.ts reads the pages' calls and fails until it's here.
 */
export const AFTER_DARK_HOST_PAGES = ["/gate"] as const;
export const AFTER_DARK_HOST_APIS = [
  "/api/auth/carry", // the sign-in hop from the show (app/api/auth/carry)
  "/api/auth/logout", // signing out of this host
  "/api/age", // the 18+ gate's confirm (app/AgeGate.tsx)
  "/api/health", // the platform's health check
  "/api/assets/", // portraits on the scene pages
  "/api/sets/", // the theater's drawn sets
  "/api/looks/", // the looks tiles (the show's builder loads After Dark's from here)
  "/api/feedback/", // the feedback dock on every page
  "/api/me", // the Nav's who's signed in and their tokens, on every page (app/Nav.tsx); not the /api/me/ under it
  "/api/line-feedback", // the theater's 👍/👎 on a line (app/useLineVotes.ts)
  "/api/library", // the Create library in the Studio and the scene writer (app/studio/CreateLibrary.tsx)
  "/api/waitlist", // the subscribe page's waitlist
  "/api/mcp", // the admin's own agents, for After Dark's tools (lib/adult/mcp.ts)
  "/api/showcase/", // the Studio's 📣 Publish and Shoot like this (lib/showcase.ts)
  "/api/creator-profile", // the creator handle 📣 Publish asks for the first time
  // #1009: jobs that read or make After Dark media run here, where its media store is (Bunny); on the show's host they
  // wrote to the show's bucket, which After Dark can't read, and read clips they couldn't find. The cron calls them here.
  "/api/jobs/after-dark-daily", // the house cast's baselines
  "/api/jobs/showcase-check", // the explicit posts' PG check reads their clips' frames
] as const;

export const isAfterDarkPage = (pathname: string): boolean => AFTER_DARK_PAGES.some((r) => covers(r, pathname));

/**
 * A link to an After Dark page. With the switch off, and on After Dark's own host, the path itself. On the show with
 * After Dark elsewhere, the way in there: its sign-in hop (app/api/auth/carry), which brings this browser's identity
 * from the show and then opens the page, so a signed-in admin arrives signed in.
 */
export function afterDarkHref(path: string, env: Env = processEnv()): string {
  const origin = afterDarkElsewhere(env);
  return origin ? `${origin}/api/auth/carry?${new URLSearchParams({ to: path })}` : path;
}

/** The base for absolute After Dark links a provider fetches (a reel's signed start frames): its own host's when it has one. */
export function afterDarkBase(fallback: string, env: Env = processEnv()): string {
  return afterDarkOrigin(env) ?? fallback;
}

export type HostMove = { redirect: string } | { robots: string } | null;

/** After Dark's own host is kept out of search: the show's search standing stays the show's. */
export const AFTER_DARK_ROBOTS = "User-agent: *\nDisallow: /\n";

/**
 * Where middleware sends a page request (null: on with it, as before).
 *  - The show, with After Dark elsewhere: After Dark's pages go there, through its sign-in hop when this browser has an
 *    identity to bring (a crawler, or a browser with none, goes straight to the page).
 *  - After Dark's own host: its pages and the 18+ gate stay, robots.txt shuts crawlers out, everything else (the show's
 *    pages, its agent docs) goes to the show.
 * `show` is the show's address (lib/site.ts siteUrl), passed in to keep this file free of imports.
 */
export function afterDarkPageMove(pathname: string, search: string, opts: { identity: boolean; bot: boolean; show: string }, env: Env = processEnv()): HostMove {
  const origin = afterDarkOrigin(env);
  if (!origin) return null;
  if (!afterDarkOnly(env)) {
    if (!isAfterDarkPage(pathname)) return null;
    const to = `${pathname}${search}`;
    return { redirect: opts.identity && !opts.bot ? `${origin}/api/auth/carry?${new URLSearchParams({ to })}` : `${origin}${to}` };
  }
  if (pathname === "/robots.txt") return { robots: AFTER_DARK_ROBOTS };
  if (isAfterDarkPage(pathname) || (AFTER_DARK_HOST_PAGES as readonly string[]).includes(pathname)) return null;
  // #1034 (the 2026-10-30 prod loop: "typed ad.botchelor.com and was bounced to the show"): its own address opens After
  // Dark, by way of the show's link to it, so the sign-in hop brings who they are (the show's /after-dark does that).
  if (pathname === "/") return { redirect: `${opts.show.replace(/\/+$/, "")}/after-dark${search}` };
  return { redirect: `${opts.show.replace(/\/+$/, "")}${pathname}${search}` };
}

type Redirect = { source: string; destination: string; permanent: false };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * next.config.ts's part: nothing at all with the switch off. On, the two settings for client code (`env`) and the API
 * redirects, all temporary (307, method and body kept), so switching back is just unsetting them:
 *  - the show: After Dark's APIs (and its look tiles) go to its host;
 *  - After Dark's host: every API but its own and the ones its pages call goes to the show.
 */
export function afterDarkNextConfig(env: Env, show: string): { env?: Record<string, string>; redirects?: () => Promise<Redirect[]> } {
  const origin = afterDarkOrigin(env);
  if (!origin) return {};
  if (!afterDarkOnly(env)) {
    // A root ending in "/" is itself and everything under it: /api/admin/after-dark/:path* matches both.
    const source = (root: string) => (root.endsWith("/") ? `${root.slice(0, -1)}/:path*` : root);
    const rules: Redirect[] = [
      ...AFTER_DARK_APIS.map((r): Redirect => ({ source: source(r), destination: `${origin}${source(r)}`, permanent: false })),
      { source: "/api/looks/:id(nsfw-[^/]+)", destination: `${origin}/api/looks/:id`, permanent: false },
    ];
    return { env: { AFTER_DARK_ORIGIN: origin }, redirects: async () => rules };
  }
  const showOrigin = (() => {
    try {
      return new URL(show).origin;
    } catch {
      return null;
    }
  })();
  // A build that would send the show's traffic nowhere fails here, rather than after it's live.
  if (!showOrigin || showOrigin === origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(showOrigin)) {
    throw new Error(`AFTER_DARK_ONLY=1 needs SITE_URL set to the show's address (got ${showOrigin ?? "nothing"}); see docs/after-dark-hosting.md`);
  }
  const keep = [...AFTER_DARK_APIS, ...AFTER_DARK_HOST_APIS]
    .map((r) => r.replace(/^\/api\//, ""))
    .map((r) => (r.endsWith("/") ? `${escapeRe(r.slice(0, -1))}(?:/|$)` : `${escapeRe(r)}$`));
  // After Dark's own tiles are in /api/looks/, kept above with the rest of the builder's tiles.
  const rules: Redirect[] = [{ source: `/api/:path((?!${keep.join("|")}).*)`, destination: `${showOrigin}/api/:path`, permanent: false }];
  return { env: { AFTER_DARK_ORIGIN: origin, AFTER_DARK_ONLY: "1" }, redirects: async () => rules };
}

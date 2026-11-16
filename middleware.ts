import { NextResponse, type NextRequest } from "next/server";
import { afterDarkOnly, afterDarkOrigin, afterDarkPageMove } from "@/lib/after-dark-host";
import { ADULT_COOKIE } from "@/lib/age";
import { PLACE_COOKIE, PLACE_TRIED_COOKIE, placeCookieFresh } from "@/lib/jurisdiction";
import { track } from "@/lib/analytics";
import { detectBot } from "@/lib/bots";
import { OLD_HOSTS, siteUrl } from "@/lib/site";
import { NOTRACK_COOKIE } from "@/lib/tracking";

/*
 * The site's other addresses (lib/site OLD_HOSTS: the old one and www). Their pages move permanently to the canonical
 * domain (siteUrl: botchelor.com), so search and players end up on one host. Only pages: the matcher below already
 * skips /api (the Stripe webhook is registered here and Stripe doesn't follow redirects; MCP clients POST, and
 * directories like Glama refuse a redirect to another host) and files (the Search Console and Bing verification files
 * keep the old property verified; /.well-known/glama.json proves www is ours). That's why www isn't a domain-level
 * redirect on Vercel: that would move /api too. Preview deployments have other hosts and never move.
 */
/** The identity cookies (lib/http: USER_COOKIE, SESSION_COOKIE), named here to keep node:crypto out of middleware. */
const IDENTITY_COOKIES = ["bz_sess", "bz_uid"];

/** A page visit on the old host: a cookieless visitor (or crawler) moves for good; a player carries their identity. */
function moveToCanonical(req: NextRequest): NextResponse | null {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host).toLowerCase();
  if (!OLD_HOSTS.has(host)) return null;
  const canonical = siteUrl();
  const target = new URL(canonical).host;
  if (target === host || target.endsWith(".vercel.app") || target.startsWith("localhost")) return null;
  const to = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (IDENTITY_COOKIES.some((c) => req.cookies.has(c))) {
    // Cookies are per host: hand who they are to the new host first (app/api/auth/carry). Temporary, per browser.
    const url = req.nextUrl.clone();
    url.pathname = "/api/auth/carry";
    url.search = "";
    url.searchParams.set("to", to);
    return NextResponse.redirect(url, 307);
  }
  return NextResponse.redirect(`${canonical}${to}`, 308);
}

/**
 * After Dark on a host of its own (lib/after-dark-host.ts), off unless AFTER_DARK_ORIGIN is set. The show sends After
 * Dark's pages there (through its sign-in hop when there's an identity to bring); After Dark's host sends the show's
 * pages back and keeps crawlers out. Temporary redirects, so unsetting it is the whole way back.
 */
function moveForAfterDark(req: NextRequest): NextResponse | null {
  if (!afterDarkOrigin()) return null;
  const { pathname, search } = req.nextUrl;
  const move = afterDarkPageMove(pathname, search, {
    identity: IDENTITY_COOKIES.some((c) => req.cookies.has(c)),
    adult: req.cookies.get(ADULT_COOKIE)?.value === "1",
    bot: detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent")) !== null,
    show: siteUrl(),
  });
  if (!move) return null;
  if ("robots" in move) return new NextResponse(move.robots, { headers: { "content-type": "text/plain; charset=utf-8" } });
  // A link's client-side fetch (RSC: its prefetch, or the navigation itself) can't follow a redirect to the other host:
  // the browser blocks it (CORS; David's console on ad.botchelor.com, 2026-10-31, for every Nav link). A plain answer
  // on this host instead: Next loads the page in full for anything that isn't its own kind of response, and that load
  // gets the redirect. Never cached, so a real page load still does. Next takes its `rsc` header off before middleware
  // sees it (#1037 missed that), so it's told by the browser's own: a fetch is `sec-fetch-dest: empty`, a page load
  // `document`.
  return fetchAnswer(req) ?? NextResponse.redirect(move.redirect, 307);
}

/**
 * A link's client-side fetch (RSC: its prefetch, or the navigation itself) can't follow a redirect to the other host:
 * the browser blocks it (CORS). A plain answer on this host instead: Next loads the page in full for anything that
 * isn't its own kind of response, and that load gets the redirect. Never cached, so a real page load still does.
 */
function fetchAnswer(req: NextRequest): NextResponse | null {
  if (req.headers.get("sec-fetch-dest") !== "empty" && req.headers.get("rsc") !== "1") return null;
  return new NextResponse("Moved to another host.", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", vary: "rsc, sec-fetch-dest" } });
}

/**
 * The agent-facing docs (and the crawler essentials). They're files, so the gate never applies to them, but
 * they're matched here so every fetch is counted: middleware runs before the CDN cache, so a cached hit still
 * counts. Track-only: these always pass straight through.
 */
const AGENT_DOCS: Record<string, string> = {
  "/llms.txt": "llms.txt",
  "/llm.txt": "llm.txt",
  "/llms-full.txt": "llms-full.txt",
  "/.well-known/mcp.json": "mcp.json",
  "/character.schema.json": "character.schema.json",
  "/robots.txt": "robots.txt",
  "/sitemap.xml": "sitemap.xml",
};
const DOC_SOURCES = new Set(["llms.txt", "llms-full.txt", "mcp.json", "agents"]);
/**
 * The policy pages: no adult content, and a person reporting or cancelling shouldn't have to pass the 18+ gate first. The
 * company pages (2026-11-10) too: a journalist, a card processor's reviewer or a security researcher reads them without
 * ticking a box, and they hold nothing adult. How it's built (/about) and what it costs (/costs) with them: the press
 * kit and the footer's Company group link to both, and like the privacy notice they name After Dark's suppliers in
 * words only.
 */
/**
 * The PG show, open without the gate (David, 2026-11-14, reversing the 2026-10-16 "whole site gated" call): the pages a
 * spectator reads or a creator builds on hold no chat, no dating and no money. First the search landings (David,
 * 2026-11-11: the ship-name generator and the chemistry test, the ship pages they make, /alternatives), then the show
 * itself: aired dates, seasons, couples, characters and creators, the agents' pages, and the builder; and a creator's
 * casting invite (/casting/invite/<code>, lib/casting-invites.ts), opened like /casting. A prefix ending in "/" covers
 * the page itself and everything under it.
 *
 * What still meets the gate is everything that isn't on this list: the swipe deck, matches, messages and companions
 * (dating and chat), a step-in date once it's started, the shop, accounts, notifications, mixers, the double-date links, and every After Dark
 * page (/after-dark/, /admin/after-dark/, lib/after-dark-host.ts: the same rule on its own host). A link from an open
 * page into one of those still meets the gate. A creator attests in the builder instead: saving a character with its
 * 18+ box ticked sets this same cookie (app/api/characters/route.ts), so the gate never asks them again; stepping into
 * a date works the same way (app/api/step-in/route.ts: the start screen's box).
 */
export const UNGATED_PREFIXES: readonly string[] = ["/tools/", "/ship/", "/alternatives/", "/episodes/", "/seasons/", "/couples/", "/characters/", "/creators/", "/agents/", "/casting/invite/"];

const UNGATED_PAGES: ReadonlySet<string> = new Set([
  // The PG show (2026-11-14): the front door, the feed and its tabs, the cast, the reunion, the house, casting, the vote, calls,
  // the import and the builder (the builder's own 18+ box is the attestation).
  "/",
  "/watch",
  "/characters",
  "/reunion",
  "/house",
  "/casting",
  "/vote",
  "/calls",
  "/import",
  "/create",
  "/agents",
  // Step into the date's cast picker and start screen (2026-11-15), opened as the builder was: its own "I'm 18 or
  // over" box is the answer, and starting a date sets this cookie. The date itself (/step-in/<id>) stays behind it.
  "/step-in",
  // The policy and company pages.
  "/terms",
  "/privacy",
  "/legal",
  "/content-policy",
  // How a crisis is handled: the open step-in start screen links here, so it opens like the other policy pages.
  "/safety",
  "/2257",
  "/report",
  "/cancel",
  "/contact",
  "/press",
  "/faq",
  "/pricing",
  "/security",
  "/accessibility",
  "/about",
  "/costs",
  // Marketing in the open (2026-11-15): every channel and post and what it brought, like /costs.
  "/marketing",
  // Everything on Botchelor (app/everything/page.tsx): the footer's old links in one list, nothing adult.
  "/everything",
]);

/**
 * Botchelor is a fictional 18+ show. Its PG pages (the lists above) open to anyone; every other page redirects
 * to /gate until the visitor confirms they're 18 or older, and the choice is remembered for a year (lib/age.ts).
 * API routes, Next internals, static files (anything with a dot) and the link-preview image routes are never
 * gated, so agents and social unfurls always work; the agent docs above are matched only to be counted.
 *
 * Crawlers and AI agents (lib/bots.ts) go straight through: they can't tick a box, and the gate exists for
 * people. Each pass is logged as a `bot_visit` so we can see who's reading the show.
 */
/**
 * After Dark's own host has no location header it can trust, so it keeps the show's signed word for where the visitor
 * is (lib/place.ts), an hour at a time: a page visit without a fresh one goes through the sign-in hop, which brings it.
 * Bots never need one; a hop that just ran and couldn't bring one (bz_place_tried) isn't repeated, so it never loops.
 */
function renewPlace(req: NextRequest): NextResponse | null {
  if (!afterDarkOnly() || !req.nextUrl.pathname.startsWith("/after-dark")) return null;
  if (req.cookies.get(ADULT_COOKIE)?.value !== "1") return null; // the 18+ gate comes first
  if (placeCookieFresh(req.cookies.get(PLACE_COOKIE)?.value) || req.cookies.has(PLACE_TRIED_COOKIE)) return null;
  if (detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) return null;
  // The hop goes by the show's host, so a link's fetch gets the full load instead (2026-11-03: David's console, CORS on
  // every link in After Dark once the hour's place cookie had run out).
  const fetched = fetchAnswer(req);
  if (fetched) return fetched;
  const url = req.nextUrl.clone();
  url.pathname = "/api/auth/carry";
  url.search = "";
  url.searchParams.set("to", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(url, 307);
}

export function middleware(req: NextRequest): NextResponse {
  const moved = moveToCanonical(req) ?? moveForAfterDark(req) ?? renewPlace(req);
  if (moved) return moved; // the query (?repohq-notrack=1 included) travels with it and is handled on arrival
  const res = route(req);
  // After Dark's own host stays out of search (lib/after-dark-host.ts); its robots.txt says so too.
  if (afterDarkOnly()) res.headers.set("x-robots-tag", "noindex, nofollow");
  // ?repohq-notrack=1 marks the owner's browser for RepoHQ's funnel (app/funnel.ts). Set on whatever goes out, the
  // 18+ gate's redirect included, so it sticks even before the gate is passed. 400 days: the most a browser keeps.
  if (req.nextUrl.searchParams.get("repohq-notrack") === "1") {
    res.cookies.set(NOTRACK_COOKIE, "1", { path: "/", maxAge: 60 * 60 * 24 * 400, sameSite: "lax", secure: true });
  }
  return res;
}

/**
 * A pair's page (a couple, their texts) at its one address, the lower id first, as a real 308 before anything renders:
 * those pages have a loading screen (loading.tsx), and a redirect from a page that's already streaming it can only
 * happen in the browser (2026-11-04 performance audit). The pages' own permanentRedirect stays as a fallback.
 */
export function canonicalPairPath(pathname: string): string | null {
  const m = /^\/(couples|messages)\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  let a: string, b: string;
  try {
    [a, b] = [decodeURIComponent(m[2]), decodeURIComponent(m[3])];
  } catch {
    return null;
  }
  return a > b ? `/${m[1]}/${m[3]}/${m[2]}` : null;
}

function route(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;

  const pair = canonicalPairPath(pathname);
  if (pair) {
    const url = req.nextUrl.clone();
    url.pathname = pair;
    return NextResponse.redirect(url, 308);
  }

  const doc = AGENT_DOCS[pathname];
  if (doc) {
    const bot = detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"));
    const kind = bot?.kind ?? "unclassified";
    track("agent_doc_fetch", { doc, bot: bot?.name ?? null, kind });
    return NextResponse.next();
  }

  // A visit that began with an agent reading one of our docs (lib/tracking.ts agentLink): count it once,
  // on landing, before the gate, so the agent → visit step of the funnel is measurable.
  if (req.nextUrl.searchParams.get("utm_medium") === "ai_agent") {
    const raw = req.nextUrl.searchParams.get("utm_source") ?? "";
    const source = DOC_SOURCES.has(raw) ? raw : "other";
    track("agent_referral_visit", { source, path: pathname });
  }

  // The gate itself, unsubscribing from email (lib/email.ts), the Sunday letter's confirm and unsubscribe links
  // (lib/newsletter.ts), the PG show and the policy pages (UNGATED_PAGES, UNGATED_PREFIXES): watching, reading the
  // rules, leaving or complaining never takes a hurdle, and none of them holds anything adult.
  const open =
    pathname === "/gate" ||
    pathname.startsWith("/email/") ||
    pathname.startsWith("/newsletter/") ||
    UNGATED_PAGES.has(pathname) ||
    UNGATED_PREFIXES.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p));
  const adult = req.cookies.get(ADULT_COOKIE)?.value === "1";

  // A crawler or agent carries no cookie: it passes everywhere, and each page it reads is counted (the agent funnel in
  // app/admin/analytics reads these), open pages included now that the show's are open.
  if (!adult) {
    const bot = detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"));
    if (bot) {
      track("bot_visit", { bot: bot.name, kind: bot.kind, path: pathname });
      return NextResponse.next();
    }
  }
  if (open || adult) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/gate";
  url.search = "";
  // Remember where they were headed so confirming drops them back there, not just on the home page.
  url.searchParams.set("from", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on pages only: skip /api, Next internals, files with an extension, and the metadata image routes.
  // Plus the agent docs and crawler files, matched by exact path so they can be counted (never gated).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|.*opengraph-image|.*icon|apple-icon).*)",
    "/llms.txt",
    "/llm.txt",
    "/llms-full.txt",
    "/.well-known/mcp.json",
    "/character.schema.json",
    "/robots.txt",
    "/sitemap.xml",
  ],
};

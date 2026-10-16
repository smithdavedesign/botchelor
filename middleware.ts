import { NextResponse, type NextRequest } from "next/server";
import { ADULT_COOKIE } from "@/lib/age";
import { track } from "@/lib/analytics";
import { detectBot } from "@/lib/bots";
import { metric } from "@vercel/functions";

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
/** A bounded page family for metric tags ("/characters/abc" → "/characters"): never a raw path or id. */
const section = (path: string) => `/${path.split("/")[1] ?? ""}`;

/**
 * Botchelor is a fictional 18+ show, so the first thing a visitor meets is an age lock: every page redirects
 * to /gate until they confirm they're 18 or older, and the choice is remembered for a year. API routes,
 * Next internals, static files (anything with a dot) and the link-preview image routes are never gated, so
 * agents and social unfurls always work; the agent docs above are matched only to be counted.
 *
 * Crawlers and AI agents (lib/bots.ts) go straight through: they can't tick a box, and the gate exists for
 * people. Each pass is logged as a `bot_visit` so we can see who's reading the show.
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;

  const doc = AGENT_DOCS[pathname];
  if (doc) {
    const bot = detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"));
    const kind = bot?.kind ?? "unclassified";
    track("agent_doc_fetch", { doc, bot: bot?.name ?? null, kind });
    metric("agent.doc_fetch", 1, { doc, kind });
    return NextResponse.next();
  }

  // A visit that began with an agent reading one of our docs (lib/tracking.ts agentLink): count it once,
  // on landing, before the gate, so the agent → visit step of the funnel is measurable.
  if (req.nextUrl.searchParams.get("utm_medium") === "ai_agent") {
    const raw = req.nextUrl.searchParams.get("utm_source") ?? "";
    const source = DOC_SOURCES.has(raw) ? raw : "other";
    track("agent_referral_visit", { source, path: pathname });
    metric("agent.referral_visit", 1, { source, section: section(pathname) });
  }

  if (pathname === "/gate" || req.cookies.get(ADULT_COOKIE)?.value === "1") return NextResponse.next();

  const bot = detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"));
  if (bot) {
    track("bot_visit", { bot: bot.name, kind: bot.kind, path: pathname });
    return NextResponse.next();
  }

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

import { NextResponse, type NextRequest } from "next/server";
import { ADULT_COOKIE } from "@/lib/age";

/**
 * Botchelor is a fictional 18+ show, so the first thing a visitor meets is an age lock: every page redirects
 * to /gate until they confirm they're 18 or older, and the choice is remembered for a year. API routes,
 * Next internals, static files (anything with a dot, including /llms.txt and /character.schema.json) and the
 * link-preview image routes are exempt via the matcher, so agents and social unfurls still work.
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/gate" || req.cookies.get(ADULT_COOKIE)?.value === "1") return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/gate";
  url.search = "";
  // Remember where they were headed so confirming drops them back there, not just on the home page.
  url.searchParams.set("from", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on pages only: skip /api, Next internals, files with an extension, and the metadata image routes.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|.*opengraph-image|.*icon|apple-icon).*)"],
};

import { headers } from "next/headers";
import { notFound } from "next/navigation";

/**
 * A real 404 for an unknown id on a page with a loading screen. A route's loading.tsx goes out the moment the page
 * starts, and with it the 200: a notFound() in the page after that can only add a noindex tag, so a search engine saw a
 * "soft 404" for every unknown character, date, couple or mixer (2026-11-22 audit; node_modules/next/dist/docs/01-app/
 * 02-guides/streaming.md, "The HTTP contract"). This sits in the route's layout beside its children, outside the loading
 * screen, so the answer waits for `known` (one small read, lib/known-ids.ts), and a no is a 404 with the site's
 * not-found page. The page's reads start alongside it, so a page that exists waits no longer.
 *
 * A page load only (a crawler, a link opened in a new tab): Next's own requests for a link's prefetch or an in-app
 * move (the `rsc` header) skip it, so a list of links costs no read each; there the page's own notFound() still shows
 * the not-found page. A read that fails keeps the page (never a 404 for a busy pool).
 */
export default async function NotFoundBeforeLoading({ known }: { known: () => Promise<boolean> }) {
  await notFoundFirst(known);
  return null;
}

/**
 * The same answer for a page's metadata: the first line of the generateMetadata of every page under such a layout. Next
 * streams a page's metadata after the page starts, so on a 404 the not-found page came with that page's own title and
 * robots once a browser (or Googlebot) had read it all: "Agent nobody-here", "Character not found", "A mixer" (2026-11-22).
 * A notFound() in a page's generateMetadata gives the 404 the not-found page's metadata instead (app/not-found.tsx).
 *
 * A page's, never a layout's: a layout's metadata is part of the not-found page's own, so a throw there left the 404
 * with no title at all (2026-11-22, live). The page passes the read its layout hands NotFoundBeforeLoading
 * (app/known-once.ts, React's cache), so a page load still makes one; Next's own requests skip it as that does, and a
 * read that fails keeps the page's own metadata.
 */
export async function notFoundFirst(known: () => Promise<boolean>): Promise<void> {
  if ((await headers()).get("rsc") === "1") return;
  if ((await known().catch(() => true)) === false) notFound();
}

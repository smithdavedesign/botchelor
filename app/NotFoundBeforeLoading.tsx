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
  if ((await headers()).get("rsc") === "1") return null;
  if ((await known().catch(() => true)) === false) notFound();
  return null;
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Not found · Botchelor",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
};

/**
 * An address no route matches: one small page, built once at build time (next.config.ts, experimental.globalNotFound).
 * Scanners and crawlers ask for thousands of these. Through app/not-found.tsx each one was a full render of the site's
 * layout: the header with its reads, the footer, 57 KB a time (2026-11-22 load audit). This page reads nothing, so Next
 * serves it as it was built. Like app/global-error.tsx it brings its own document, the site's stylesheet and the
 * wordmark, and follows the device's light or dark (the theme cookie is the layout's to read).
 *
 * A page that calls notFound() (a private character, a date that's gone) still shows app/not-found.tsx inside the site's
 * layout: its route has already run by then. Plain links, not <Link>: a dead end has nothing worth prefetching.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="logo">
            Botchelor
          </a>
        </header>
        <main id="main">
          <article className="not-found">
            <p className="kicker">404</p>
            <h1>This page isn&apos;t on the show</h1>
            <p className="muted">The link may be old, or what it pointed to is private or gone.</p>
            <p className="cta-row">
              <a className="button" href="/">
                Back to the show
              </a>
              <a className="button secondary" href="/characters">
                See the characters
              </a>
            </p>
          </article>
        </main>
      </body>
    </html>
  );
}

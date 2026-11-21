"use client";

import "./globals.css";
import PageError from "./PageError";

/**
 * When the site's frame itself fails (app/layout.tsx, the header's reads), Next shows this in place of the whole layout.
 * So it brings its own document, the site's stylesheet and the wordmark, and follows the device's light or dark (the
 * theme cookie is the layout's to read). Without it, Next's bare error page.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · Botchelor</title>
        <header className="site-header">
          {/* A full page load, not a client move: the layout that failed is the one a move would keep. */}
          <a href="/" className="logo">
            Botchelor
          </a>
        </header>
        <main id="main">
          <PageError title="Botchelor didn't load" retry={retry} />
        </main>
      </body>
    </html>
  );
}

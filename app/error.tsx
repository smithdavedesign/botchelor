"use client";

import PageError from "./PageError";

/**
 * Any page that fails to render, after a read that failed (the database pool busy, #1948) or a bug: inside the site's
 * layout with a way to try again, rather than Next's bare error page. A section's own error.tsx can say more
 * (app/couples/[a]/[b]/error.tsx); a failure in the root layout itself shows app/global-error.tsx.
 */
export default function SiteError({ retry }: { error: unknown; retry: () => void }) {
  return <PageError title="This page didn't load" retry={retry} />;
}

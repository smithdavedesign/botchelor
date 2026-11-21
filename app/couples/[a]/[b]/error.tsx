"use client";

import PageError from "@/app/PageError";

/**
 * When a couple page can't load at all: its two characters or their record didn't read (the database pool busy, #1948).
 * The site's error page (app/error.tsx) naming what didn't load. The parts the page can do without leave themselves out
 * instead (page.tsx orElse).
 */
export default function CoupleError({ retry }: { error: unknown; retry: () => void }) {
  return <PageError title="This couple didn't load" retry={retry} />;
}

"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Where the season's arc runs under the header (the design system's all-screens board, 2026-11-11): the show's
 * spectator pages, the ones about the season itself. Not on the theater (it takes the whole screen), nor on the pages
 * about you (create, matches, account, pricing), where the season isn't the subject. The characters directory counts:
 * it opens on this season's cast (2026-11-13 live review: it and /seasons were the two show pages without the strip).
 */
const SPECTATOR = [/^\/$/, /^\/watch\/?$/, /^\/showcase\/?$/, /^\/reunion\/?$/, /^\/seasons(\/|$)/, /^\/characters\/?$/, /^\/cast\/?$/, /^\/reviews\/?$/, /^\/graph\/?$/, /^\/episodes\/[^/]+\/?$/, /^\/couples\//, /^\/mixers\//, /^\/casting\/?$/, /^\/doubles\//];

export function onSpectatorPage(path: string): boolean {
  return SPECTATOR.some((re) => re.test(path));
}

export default function SeasonStrip({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  if (!onSpectatorPage(path)) return null;
  return <div className="season-strip">{children}</div>;
}

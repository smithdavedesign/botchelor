"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AD_ACCOUNT, adLinks, atLink } from "@/app/Nav";
import type { AdDoors } from "@/lib/adult/door-links";

/**
 * After Dark's doors on every After Dark page where the header is the show's (mobile audit C10, 2026-11-20: Gallery,
 * Studio and Account had no way across but the browser's back). On After Dark's own host the header already is this
 * row (app/Nav.tsx adLinks), so the layout leaves it out there. Same links, same "you are here" rule as the header.
 */
export default function AdSubNav({ doors }: { doors: AdDoors }) {
  const pathname = usePathname() ?? "";
  return (
    <nav className="ad-subnav" aria-label="After Dark">
      {[...adLinks(doors), AD_ACCOUNT].map((l) => (
        <Link key={l.href} href={l.href} className="ad-subnav-link" aria-current={atLink(l, pathname) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

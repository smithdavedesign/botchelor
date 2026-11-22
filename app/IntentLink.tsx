"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/** Focus from the keyboard (Tab), not the focus a tap gives a link on some phones just before it navigates anyway. */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
}

/**
 * A link prefetched on intent only: a mouse or pen resting on it, or keyboard focus. Never just for being on screen, and
 * never on a tap (a tap is already the navigation; a prefetch would only add requests to it).
 *
 * For the links on every page: the header, the phone's tab bar, the show's tabs and the season's arc (2026-11-22 load
 * audit). A plain <Link> prefetches as soon as it scrolls into view, two requests to the app each (the route's tree and
 * its data, which renders the root layout), so a page view sent about 29 of them before anyone clicked anything. On
 * hover there's still time to prefetch before the click lands, so the header keeps its instant feel on a desktop.
 *
 * `prefetch={false}` still means never (the show's links on After Dark's host, app/layout.tsx).
 */
export default function IntentLink({ prefetch, onPointerEnter, onFocus, ...props }: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      // null is Next's default prefetch, once there's intent (node_modules/next/dist/docs: "Hover-triggered prefetch").
      prefetch={prefetch === false || !intent ? false : prefetch}
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") setIntent(true);
        onPointerEnter?.(e);
      }}
      onFocus={(e) => {
        if (keyboardFocus(e.currentTarget)) setIntent(true);
        onFocus?.(e);
      }}
    />
  );
}

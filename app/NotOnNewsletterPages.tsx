"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Leaves the footer's sign-up (app/NewsletterSignup.tsx) off the Sunday letter's own pages: /newsletter already asks, and
 * its confirm and unsubscribe pages have just been answered, so a second form under them only confuses ("You're on the
 * list", then "Your email · Sign up"). The server and the browser read the same path, so hydration agrees.
 */
export default function NotOnNewsletterPages({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname === "/newsletter" || pathname?.startsWith("/newsletter/") ? null : children;
}

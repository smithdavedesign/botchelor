"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { pageView, startEngagement } from "./engagement";

/**
 * The engagement beacon on every page (app/engagement.ts): starts the click, scroll and time listeners once, and counts
 * a page view on every move between pages. Renders after <FunnelBeacon>, which sets whether this browser may be counted.
 */
export default function EngagementBeacon({ afterDarkHost }: { afterDarkHost: boolean }) {
  const pathname = usePathname();
  useEffect(() => {
    startEngagement({ afterDarkHost });
  }, [afterDarkHost]);
  useEffect(() => {
    pageView();
  }, [pathname]);
  return null;
}

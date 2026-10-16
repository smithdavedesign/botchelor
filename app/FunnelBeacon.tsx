"use client";

import { useEffect } from "react";
import { configureFunnel, NOTRACK_KEY, sendFunnel } from "./funnel";

/**
 * Counts this browser session's visit for RepoHQ (app/funnel.ts). Opening any page with ?repohq-notrack=1 marks the
 * browser as the owner's, so its visits, dates and Buy clicks are never counted.
 */
export default function FunnelBeacon({ production, consentDefault }: { production: boolean; consentDefault: boolean }) {
  useEffect(() => {
    try {
      if (new URLSearchParams(location.search).get("repohq-notrack") === "1") localStorage.setItem(NOTRACK_KEY, "1");
    } catch {
      /* storage blocked */
    }
    configureFunnel({ production, consentDefault });
    sendFunnel("visit");
  }, [production, consentDefault]);
  return null;
}

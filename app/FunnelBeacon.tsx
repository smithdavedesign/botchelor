"use client";

import { useEffect } from "react";
import { trackConversion } from "./conversion";
import { configureFunnel, NOTRACK_KEY, sendFunnel } from "./funnel";

/**
 * Counts this browser session's visit for RepoHQ (app/funnel.ts). Opening any page with ?repohq-notrack=1 marks the
 * browser as the owner's, so its visits, dates and Buy clicks are never counted.
 * It also sends the two conversions that land on a page after a redirect: sign_up after a new Google account
 * (the callback's one-shot cookie) and purchase on Stripe's return to /shop?checkout=success.
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
    try {
      // Set by app/api/auth/google/callback on a new account.
      if (document.cookie.split(";").some((c) => c.trim() === "bz_signup=google")) {
        document.cookie = "bz_signup=; Path=/; SameSite=Lax; Max-Age=0";
        trackConversion("sign_up", { method: "google" });
      }
      const url = new URL(location.href);
      if (url.pathname === "/shop" && url.searchParams.get("checkout") === "success") {
        // Drop the flag so a refresh doesn't count the purchase twice (the thank-you notice is already rendered).
        url.searchParams.delete("checkout");
        history.replaceState(history.state, "", url.pathname + url.search + url.hash);
        trackConversion("purchase", { currency: "USD" });
      }
    } catch {
      /* analytics must never break the page */
    }
  }, [production, consentDefault]);
  return null;
}
